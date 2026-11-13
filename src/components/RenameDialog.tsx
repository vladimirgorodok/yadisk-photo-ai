import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useApp } from '../state/AppContext';
import { useDevice, type CaptionStatus } from '../state/DeviceContext';
import { captionImage, preloadCaptioner, toRussian, setModelStatus } from '../lib/ai';
import { cleanCaption, suggestFileName } from '../lib/naming';
import { extOf, localThumbUrl, readBlob } from '../lib/localfs';
import type { PhotoRec } from '../types';

type ItemState = 'wait' | 'captioning' | 'ready' | 'renamed' | 'failed';

interface Item {
  path: string;
  name: string;
  caption?: string;
  proposed: string;
  checked: boolean;
  state: ItemState;
  error?: string;
}

/**
 * «Переименовать по содержимому»: BLIP строит подпись изображения,
 * переводчик en→ru даёт русское имя, пользователь правит и выбирает файлы.
 */
export function RenameDialog({ files, onClose }: { files: PhotoRec[]; onClose: () => void }) {
  const app = useApp();
  const device = useDevice();
  const [items, setItems] = useState<Item[]>(() =>
    files.map((f) => ({
      path: f.path,
      name: f.name,
      proposed: f.name,
      checked: true,
      state: 'wait' as ItemState,
    })),
  );
  const [phase, setPhase] = useState<'model' | 'captioning' | 'ready' | 'renaming' | 'done'>('model');
  const [progress, setProgress] = useState({ done: 0, total: files.length, detail: 'Загрузка модели подписей…' });
  const [summary, setSummary] = useState<{ done: number; failed: { from: string; error: string }[] } | null>(null);
  const abortRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const setItem = useCallback((path: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.path === path ? { ...it, ...patch } : it)));
  }, []);

  // Подписи: модель BLIP + переводчик en→ru грузятся с прогрессом в шапке.
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
          setItem(it.path, { state: 'captioning' });
          setProgress({ done, total, detail: it.name });
          try {
            // Оригинал даёт лучшую подпись; если формат не декодируется — миниатюра.
            let caption = '';
            try {
              caption = await captionImage(await readBlob(it.path, 'image/jpeg'));
            } catch {
              const rec = files.find((f) => f.path === it.path);
              if (rec?.thumb) caption = await captionImage(rec.thumb);
            }
            caption = caption.trim();
            if (!caption) throw new Error('пустая подпись');
            const ru = cleanCaption(await toRussian(caption));
            const rec = files.find((f) => f.path === it.path);
            const proposed = suggestFileName(ru, rec?.mtime, extOf(it.name));
            setItem(it.path, { caption, proposed, state: 'ready' });
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

  const selectedCount = items.filter((i) => i.checked && i.state !== 'failed').length;

  const doRename = async () => {
    const pairs = new Map<string, string>();
    for (const it of itemsRef.current) {
      if (!it.checked || it.state === 'failed') continue;
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
            <button
              className="btn primary"
              onClick={doRename}
              disabled={phase !== 'ready' || !selectedCount}
            >
              {phase === 'renaming' ? 'Переименовываю…' : `Переименовать выделенные (${selectedCount})`}
            </button>
          </>
        )
      }
    >
      <p className="muted">
        Модель BLIP описывает каждое фото, переводчик переводит подпись на русский — получается имя
        вида <code>2024-05-12_кот_на_диване.jpg</code>. Имя можно поправить вручную. После
        переименования действие отменяется кнопкой ↶ в разделе «Устройство».
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

      <div className="rename-list">
        {items.map((it) => {
          const rec = files.find((f) => f.path === it.path);
          const src = rec?.thumb ? localThumbUrl(it.path, rec.thumb) : undefined;
          return (
            <div key={it.path} className={`rename-item ${it.state}`}>
              <label className="rename-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={it.checked && it.state !== 'failed'}
                  disabled={it.state === 'wait' || it.state === 'captioning' || it.state === 'failed'}
                  onChange={(e) => toggle(it.path, e.target.checked)}
                />
              </label>
              <div className="rename-thumb">
                {src ? <img src={src} alt="" loading="lazy" /> : <span>🖼️</span>}
              </div>
              <div className="rename-main">
                <input
                  className="rename-input"
                  type="text"
                  value={it.proposed}
                  spellCheck={false}
                  disabled={it.state === 'wait' || it.state === 'captioning'}
                  onChange={(e) => edit(it.path, e.target.value)}
                />
                <div className="rename-caption">
                  {it.state === 'wait' && <span className="muted">в очереди…</span>}
                  {it.state === 'captioning' && <span className="muted">анализирую…</span>}
                  {it.state === 'ready' && (it.caption || <span className="muted">без подписи</span>)}
                  {it.state === 'failed' && <span className="err-text">⚠ {it.error}</span>}
                  {it.state === 'renamed' && <span className="ok-text">переименован</span>}
                  <span className="rename-orig"> был: {it.name}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
