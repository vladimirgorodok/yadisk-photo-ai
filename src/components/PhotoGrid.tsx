import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoRec } from '../types';
import { previewCache } from '../lib/scan';
import { useApp } from '../state/AppContext';
import { clamp } from '../lib/util';

export function relevance(score: number): number {
  return clamp((score - 0.1) / 0.25, 0, 1);
}

export function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (/^(jpe?g|png|webp|heic|heif|bmp|gif|avif|tiff?)$/.test(ext)) return '🖼️';
  if (/^(mp4|mov|avi|mkv|webm)$/.test(ext)) return '🎬';
  if (/^(mp3|wav|flac|ogg|m4a)$/.test(ext)) return '🎵';
  if (/^(pdf|docx?|xlsx?|pptx?|txt)$/.test(ext)) return '📄';
  if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return '🗜️';
  return '📦';
}

/** Миниатюра с обновлением просроченной подписанной ссылки. */
export function Thumb({ rec }: { rec: PhotoRec }) {
  const app = useApp();
  const [src, setSrc] = useState<string | undefined>(() => previewCache.get(rec.path) ?? rec.preview);
  const attempts = useRef(0);

  const refresh = useCallback(() => {
    if (!app.api || attempts.current >= 2) {
      setSrc(undefined);
      return;
    }
    attempts.current++;
    app.api
      .resource(rec.path, true)
      .then((item) => {
        if (item.preview) {
          previewCache.set(rec.path, item.preview);
          setSrc(item.preview);
        } else {
          setSrc(undefined);
        }
      })
      .catch(() => setSrc(undefined));
  }, [app.api, rec.path]);

  useEffect(() => {
    attempts.current = 0;
    setSrc(previewCache.get(rec.path) ?? rec.preview);
  }, [rec.path, rec.preview]);

  useEffect(() => {
    if (!src) refresh();
  }, [src, refresh]);

  if (!src) return <div className="thumb-empty">{fileIcon(rec.name)}</div>;
  return <img src={src} alt={rec.name} loading="lazy" decoding="async" onError={refresh} />;
}

export function PhotoGrid({
  items,
  scores,
}: {
  items: PhotoRec[];
  scores?: Map<string, number>;
}) {
  const app = useApp();
  return (
    <div className="grid">
      {items.map((rec) => {
        const src = previewCache.get(rec.path) ?? rec.preview;
        const sel = app.isSelected(rec.path);
        const score = scores?.get(rec.path);
        return (
          <div
            key={rec.path}
            className={`card ${sel ? 'sel' : ''}`}
            onClick={() => app.toggleSelect({ path: rec.path, name: rec.name, preview: src })}
            role="checkbox"
            aria-checked={sel}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                app.toggleSelect({ path: rec.path, name: rec.name, preview: src });
              }
            }}
          >
            <div className="thumb">
              <Thumb rec={rec} />
              <span className={`check ${sel ? 'on' : ''}`} aria-hidden>
                {sel ? '✓' : ''}
              </span>
              {score !== undefined && (
                <span className="score" title={`Релевантность: ${Math.round(relevance(score) * 100)}%`}>
                  {Math.round(relevance(score) * 100)}%
                </span>
              )}
            </div>
            <div className="card-title" title={rec.name}>
              {rec.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
