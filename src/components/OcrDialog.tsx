import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { RenameReview } from './RenameReview';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import { exifDate } from '../lib/exif';
import { nameFromMask } from '../lib/naming';
import { extOf, guessMime, makeThumb, readBlob, type DeviceFile } from '../lib/localfs';
import { getOcrWorker, hasText, ocrBlob, textForName, toOcrJpeg } from '../lib/ocr';
import type { ReviewItem } from '../lib/reviewTypes';

/**
 * «Текст на картинке»: Tesseract (rus+eng) распознаёт текст на изображениях
 * из выбранной папки, отбирает картинки с осмысленным текстом и предлагает
 * имена по маске «{text} {date}» с настоящей датой файла (EXIF → mtime).
 */
export function OcrDialog({ files, onClose }: { files: DeviceFile[]; onClose: () => void }) {
  const app = useApp();
  const device = useDevice();
  const [items, setItems] = useState<ReviewItem[]>(() =>
    files.map((f) => ({
      path: f.path,
      name: f.name,
      proposed: f.name,
      checked: false,
      state: 'wait' as const,
    })),
  );
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const [phase, setPhase] = useState<'model' | 'scanning' | 'ready' | 'renaming' | 'done'>('model');
  const [progress, setProgress] = useState({ done: 0, total: files.length, detail: 'Загрузка распознавания текста…' });
  const [summary, setSummary] = useState<{ done: number; failed: { from: string; error: string }[] } | null>(null);
  const abortRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const setItem = useCallback((path: string, patch: Partial<ReviewItem>) => {
    setItems((prev) => prev.map((it) => (it.path === path ? { ...it, ...patch } : it)));
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setPhase('model');
        await getOcrWorker((status, pct) => {
          setProgress((p) => ({ ...p, detail: pct < 100 ? `${status} ${pct}%` : p.detail }));
        });
        if (cancelled || abortRef.current) return;
        setPhase('scanning');
        let done = 0;
        let withText = 0;
        const total = itemsRef.current.length;
        for (const it of itemsRef.current) {
          if (cancelled || abortRef.current) break;
          if (it.state !== 'wait') {
            done++;
            continue;
          }
          setItem(it.path, { state: 'busy', note: 'распознаю…' });
          setProgress({ done, total, detail: it.name });
          try {
            const f = files.find((x) => x.path === it.path)!;
            const blob = await readBlob(it.path, guessMime(it.name));
            // Настоящая дата: EXIF → mtime (переименование на неё не влияет).
            const date = (await exifDate(blob)) ?? f.mtime;
            try {
              const t = await makeThumb(blob, 200);
              setThumbs((prev) => {
                const next = new Map(prev);
                next.set(it.path, URL.createObjectURL(t));
                return next;
              });
            } catch {
              /* без миниатюры */
            }
            let jpeg: Blob;
            try {
              jpeg = await toOcrJpeg(blob);
            } catch {
              setItem(it.path, { state: 'failed', error: 'формат не декодируется (нужен JPEG/PNG/WebP)' });
              done++;
              continue;
            }
            const res = await ocrBlob(jpeg);
            if (!hasText(res.text, res.confidence)) {
              setItem(it.path, { state: 'skip', note: 'текста нет', date });
              done++;
              continue;
            }
            const text = textForName(res.text);
            if (!text) {
              setItem(it.path, { state: 'skip', note: 'текст не разобран', date });
              done++;
              continue;
            }
            withText++;
            const proposed = nameFromMask(app.settings.renameMasks.ocr, {
              text,
              dateMs: date,
              origName: it.name,
              ext: extOf(it.name),
            });
            setItem(it.path, { caption: text, date, proposed, checked: true, state: 'ready' });
          } catch (e) {
            setItem(it.path, {
              state: 'failed',
              error: (e as Error)?.message || 'не удалось распознать',
            });
          }
          done++;
          setProgress({ done, total, detail: `${it.name}${withText ? ` · с текстом: ${withText}` : ''}` });
          await new Promise((r) => setTimeout(r, 0));
        }
        if (!cancelled && !abortRef.current) setPhase('ready');
      } catch (e) {
        if (!cancelled) {
          app.toast((e as Error)?.message || 'Не удалось запустить распознавание текста', 'error');
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

  const stopScan = () => {
    abortRef.current = true;
    setPhase('ready');
  };

  const toggle = (path: string, checked: boolean) => setItem(path, { checked });
  const edit = (path: string, proposed: string) => setItem(path, { proposed });

  const readyCount = items.filter((i) => i.state === 'ready').length;
  const selectedCount = items.filter((i) => i.checked && i.state === 'ready').length;
  const skipCount = items.filter((i) => i.state === 'skip').length;
  const failedCount = items.filter((i) => i.state === 'failed').length;

  const doRename = async () => {
    const pairs = new Map<string, string>();
    for (const it of itemsRef.current) {
      if (!it.checked || it.state !== 'ready') continue;
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

  const busy = phase === 'model' || phase === 'scanning' || phase === 'renaming';

  return (
    <Modal
      title="Распознавание текста на картинках"
      onClose={onClose}
      wide
      footer={
        phase === 'done' ? (
          <button className="btn primary" onClick={onClose}>
            Готово
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={phase === 'scanning' ? stopScan : onClose}>
              {phase === 'scanning' ? 'Остановить' : 'Отмена'}
            </button>
            <button className="btn primary" onClick={doRename} disabled={phase !== 'ready' || !selectedCount}>
              {phase === 'renaming' ? 'Переименовываю…' : `Переименовать выделенные (${selectedCount})`}
            </button>
          </>
        )
      }
    >
      <p className="muted">
        Tesseract распознаёт текст (русский + английский, офлайн после первой загрузки словарей).
        Картинки без текста пропускаются. Имя собирается по маске{' '}
        <code>{app.settings.renameMasks.ocr || '{text} {date}'}</code>: найденный текст, пробел и
        настоящая дата файла (EXIF дата съёмки, иначе дата файла — не копирования и не
        переименования). Формат даты: <b>ДД.ММ.ГГ</b>.
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
        {phase === 'scanning' && `Распознаю ${progress.done + 1}/${progress.total}: ${progress.detail}`}
        {phase === 'ready' &&
          `С текстом: ${readyCount}${skipCount ? ` · без текста: ${skipCount}` : ''}${failedCount ? ` · ошибок: ${failedCount}` : ''}`}
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
          Маска: <code>{app.settings.renameMasks.ocr}</code> · изменить — в «Настройках»
        </div>
      )}
    </Modal>
  );
}
