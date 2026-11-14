import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { RenameReview } from './RenameReview';
import { useApp } from '../state/AppContext';
import { useDevice, type CaptionStatus } from '../state/DeviceContext';
import { captionImage, preloadCaptioner, toRussian, setModelStatus } from '../lib/ai';
import { cleanCaption, nameFromMask } from '../lib/naming';
import { exifDate } from '../lib/exif';
import { extOf, makeThumb, readBlob } from '../lib/localfs';
import type { PhotoRec } from '../types';
import type { ReviewItem } from '../lib/reviewTypes';

/**
 * «Переименовать по содержимому»: модель описывает изображение,
 * переводчик даёт русское имя, имя собирается по маске из настроек
 * с настоящей датой (EXIF → mtime). Пользователь правит и выбирает файлы.
 */
export function RenameDialog({ files, onClose }: { files: PhotoRec[]; onClose: () => void }) {
  const app = useApp();
  const device = useDevice();
  const recs = useRef(new Map(files.map((f) => [f.path, f]))).current;
  const [items, setItems] = useState<ReviewItem[]>(() =>
    files.map((f) => ({
      path: f.path,
      name: f.name,
      proposed: f.name,
      checked: true,
      state: 'wait' as const,
    })),
  );
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const [phase, setPhase] = useState<'model' | 'captioning' | 'ready' | 'renaming' | 'done'>('model');
  const [progress, setProgress] = useState({ done: 0, total: files.length, detail: 'Загрузка модели подписей…' });
  const [summary, setSummary] = useState<{ done: number; failed: { from: string; error: string }[] } | null>(null);
  const abortRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const setItem = useCallback((path: string, patch: Partial<ReviewItem>) => {
    setItems((prev) => prev.map((it) => (it.path === path ? { ...it, ...patch } : it)));
  }, []);

  // Подписи: модель + переводчик грузятся с прогрессом в шапке.
  useEffect(() => {
    setModelStatus((s: CaptionStatus | null) => {
      if (s) setProgress((p) => ({ ...p, detail: s.msg ? `${s.msg}${s.pct < 100 ? ` ${s.pct}%` : ''}` : p.detail }));
    });
    return () => setModelStatus(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await preloadCaptioner();
        if (cancelled || abortRef.current) return;
        setPhase('captioning');
        let done = 0;
        const total = itemsRef.current.length;
        for (const it of itemsRef.current) {
          if (cancelled || abortRef.current) break;
          if (it.state !== 'wait') {
            done++;
            continue;
          }
          setItem(it.path, { state: 'busy', note: 'анализирую…' });
          setProgress({ done, total, detail: it.name });
          try {
            // Оригинал даёт лучшую подпись; если формат не декодируется — миниатюра.
            const rec = recs.get(it.path);
            let blob: Blob;
            try {
              blob = await readBlob(it.path, 'image/jpeg');
            } catch {
              if (!rec?.thumb) throw new Error('файл не читается');
              blob = rec.thumb;
            }
            // Настоящая дата: EXIF (дата съёмки) → время файла (не меняется при переименовании).
            const date = (await exifDate(blob)) ?? rec?.mtime;
            // Миниатюра для списка — из того же прочитанного блоба.
            try {
              const t = await makeThumb(blob, 256);
              setThumbs((prev) => {
                const next = new Map(prev);
                next.set(it.path, URL.createObjectURL(t));
                return next;
              });
            } catch {
              /* без миниатюры — покажем эмодзи */
            }
            let caption = '';
            try {
              caption = await captionImage(blob);
            } catch {
              if (rec?.thumb) caption = await captionImage(rec.thumb);
            }
            caption = caption.trim();
            if (!caption) throw new Error('пустая подпись');
            const ru = cleanCaption(await toRussian(caption));
            const proposed = nameFromMask(app.settings.renameMasks.content, {
              text: ru,
              dateMs: date,
              origName: it.name,
              ext: extOf(it.name),
            });
            setItem(it.path, { caption: ru, date, proposed, state: 'ready' });
          } catch (e) {
            setItem(it.path, { state: 'failed', error: (e as Error)?.message || 'не удалось подписать' });
          }
          done++;
          await new Promise((r) => setTimeout(r, 0));
        }
        if (!cancelled && !abortRef.current) setPhase('ready');
      } catch (e) {
        if (!cancelled) {
          app.toast((e as Error)?.message || 'Не удалось загрузить модель подписей', 'error');
          onClose();
        }
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCaptioning = () => {
    abortRef.current = true;
    setPhase('ready');
  };

  const toggle = (path: string, checked: boolean) => setItem(path, { checked });
  const edit = (path: string, proposed: string) => setItem(path, { proposed });

  const selectedCount = items.filter((i) => i.checked && i.state !== 'failed' && i.state !== 'skip').length;

  const doRename = async () => {
    const pairs = new Map<string, string>();
    for (const it of itemsRef.current) {
      if (!it.checked || it.state === 'failed' || it.state === 'skip') continue;
      const target = it.proposed.trim();
      if (!target || target === it.name || target.includes('/')) continue;
      pairs.set(it.path, target);
    }
    if (!pairs.size) {
      app.toast('Нет файлов с изменённым именем', 'info');
      return;
    }
    setPhase('renaming');
    setProgress({ done: 0, total: pairs.size, detail: 'Переименовываю…' });
    const res = await device.renameLocal(pairs);
    setSummary(res);
    setPhase('done');
    if (res.done) app.toast(`Переименовано файлов: ${res.done}`, 'success');
    if (res.failed.length) app.toast(`Ошибок: ${res.failed.length} (${res.failed[0].error})`, 'error');
  };

  const failedCount = items.filter((i) => i.state === 'failed').length;
  const busy = phase === 'model' || phase === 'captioning' || phase === 'renaming';

  return (
    <Modal
      title="Переименовать по содержимому"
      onClose={onClose}
      wide
      footer={
        phase === 'done' ? (
          <button className="btn primary" onClick={onClose}>
            Готово
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={phase === 'captioning' ? stopCaptioning : onClose}>
              {phase === 'captioning' ? 'Остановить подпись' : 'Отмена'}
            </button>
            <button className="btn primary" onClick={doRename} disabled={phase !== 'ready' || !selectedCount}>
              {phase === 'renaming' ? 'Переименовываю…' : `Переименовать выделенные (${selectedCount})`}
            </button>
          </>
        )
      }
    >
      <p className="muted">
        ИИ описывает каждое фото, переводчик переводит подпись на русский — имя собирается по
        маске <code>{app.settings.renameMasks.content || '{text} {date}'}</code> с настоящей датой
        снимка (EXIF, иначе дата файла). Имя можно поправить вручную. Отмена — кнопкой ↶
        в разделе «Устройство».
      </p>

      {phase !== 'ready' && phase !== 'done' && (
        <div className="bar-wrap">
          <div
            className="bar-fill"
            style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
          />
        </div>
      )}
      <div className="index-line muted">
        {phase === 'model' && progress.detail}
        {phase === 'captioning' && `Подпись ${progress.done + 1}/${progress.total}: ${progress.detail}`}
        {phase === 'ready' && `Готово к переименованию: ${selectedCount}${failedCount ? `, ошибок: ${failedCount}` : ''}`}
        {phase === 'renaming' && `Переименовываю ${progress.done}/${progress.total}…`}
        {phase === 'done' && summary && `Переименовано: ${summary.done}${summary.failed.length ? `, ошибок: ${summary.failed.length}` : ''}`}
      </div>

      {phase === 'done' && summary && summary.failed.length > 0 && (
        <ul className="dl-list">
          {summary.failed.slice(0, 6).map((f) => (
            <li key={f.from} title={f.from}>
              {f.from.split('/').pop()}: {f.error}
            </li>
          ))}
        </ul>
      )}

      <RenameReview items={items} thumbs={thumbs} onToggle={toggle} onEdit={edit} />
      {!busy && phase !== 'done' && (
        <div className="index-line muted">
          Маска: <code>{app.settings.renameMasks.content}</code> · изменить — в «Настройках»
        </div>
      )}
    </Modal>
  );
}
