import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoRec } from '../types';
import { previewCache } from '../lib/scan';
import { localThumbUrl } from '../lib/localfs';
import { useApp } from '../state/AppContext';
import { clamp } from '../lib/util';
import { CopyDialog, DeleteConfirm, FileInfoDialog } from './CardDialogs';
import { MoveDialog } from './MoveDialog';

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
  // Локальный файл устройства: миниатюра хранится в IndexedDB как Blob.
  const localUrl = rec.thumb ? localThumbUrl(rec.path, rec.thumb) : undefined;
  const [src, setSrc] = useState<string | undefined>(localUrl ?? previewCache.get(rec.path) ?? rec.preview);
  const attempts = useRef(0);

  const refresh = useCallback(() => {
    // у локальных файлов подписных ссылок не бывает — только Blob-миниатюра
    if (rec.thumb || rec.source === 'local') return;
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
  }, [app.api, rec.path, rec.thumb, rec.source]);

  useEffect(() => {
    attempts.current = 0;
    setSrc(localUrl ?? previewCache.get(rec.path) ?? rec.preview);
  }, [rec.path, rec.preview, localUrl]);

  useEffect(() => {
    if (!src) refresh();
  }, [src, refresh]);

  if (!src) return <div className="thumb-empty">{fileIcon(rec.name)}</div>;
  return <img src={src} alt={rec.name} loading="lazy" decoding="async" onError={refresh} />;
}

type CardAction = { type: 'info' | 'copy' | 'move' | 'delete'; rec: PhotoRec };

export function PhotoGrid({
  items,
  scores,
}: {
  items: PhotoRec[];
  scores?: Map<string, number>;
}) {
  const app = useApp();
  const [menu, setMenu] = useState<string | null>(null);
  const [action, setAction] = useState<CardAction | null>(null);

  return (
    <div className="grid" onClick={() => setMenu(null)}>
      {items.map((rec) => {
        const src = rec.thumb
          ? localThumbUrl(rec.path, rec.thumb)
          : (previewCache.get(rec.path) ?? rec.preview);
        const sel = app.isSelected(rec.path);
        const score = scores?.get(rec.path);
        const menuOpen = menu === rec.path;
        return (
          <div
            key={rec.path}
            className={`card ${sel ? 'sel' : ''}`}
            onClick={() => {
              setMenu(null);
              app.toggleSelect({ path: rec.path, name: rec.name, preview: src });
            }}
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
              <button
                className={`card-more ${menuOpen ? 'on' : ''}`}
                aria-label="Действия с файлом"
                title="Копировать, переместить, удалить, свойства"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menuOpen ? null : rec.path);
                }}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="card-menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      setMenu(null);
                      setAction({ type: 'info', rec });
                    }}
                  >
                    ℹ Свойства
                  </button>
                  <button
                    onClick={() => {
                      setMenu(null);
                      setAction({ type: 'copy', rec });
                    }}
                  >
                    📋 Копировать
                  </button>
                  <button
                    onClick={() => {
                      setMenu(null);
                      setAction({ type: 'move', rec });
                    }}
                  >
                    📁 Переместить
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setMenu(null);
                      setAction({ type: 'delete', rec });
                    }}
                  >
                    🗑 Удалить
                  </button>
                </div>
              )}
            </div>
            <div className="card-title" title={rec.name}>
              {rec.name}
            </div>
          </div>
        );
      })}

      {action?.type === 'info' && <FileInfoDialog rec={action.rec} onClose={() => setAction(null)} />}
      {action?.type === 'copy' && <CopyDialog rec={action.rec} onClose={() => setAction(null)} />}
      {action?.type === 'move' && (
        <MoveDialog
          mode={action.rec.source === 'local' ? 'local' : 'disk'}
          files={[{ path: action.rec.path, name: action.rec.name, preview: undefined }]}
          defaultPath={action.rec.dir || (action.rec.source === 'local' ? '/' : 'disk:/')}
          title={`Переместить: ${action.rec.name}`}
          onClose={() => setAction(null)}
        />
      )}
      {action?.type === 'delete' && <DeleteConfirm rec={action.rec} onClose={() => setAction(null)} />}
    </div>
  );
}
