import type { ReviewItem } from '../lib/reviewTypes';

/**
 * Общий список-ревью для функций переименования: миниатюра, чекбокс,
 * редактируемое предложенное имя, подпись/распознанный текст и статус.
 * Используется в «Переименовании по содержимому» и «Тексте на картинке».
 */
export function RenameReview({
  items,
  thumbs,
  onToggle,
  onEdit,
}: {
  items: ReviewItem[];
  thumbs?: Map<string, string>;
  onToggle: (path: string, checked: boolean) => void;
  onEdit: (path: string, proposed: string) => void;
}) {
  return (
    <div className="rename-list">
      {items.map((it) => {
        const src = thumbs?.get(it.path);
        return (
          <div key={it.path} className={`rename-item ${it.state}`}>
            <label className="rename-check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={it.checked && it.state !== 'failed' && it.state !== 'skip'}
                disabled={it.state === 'wait' || it.state === 'busy' || it.state === 'failed' || it.state === 'skip'}
                onChange={(e) => onToggle(it.path, e.target.checked)}
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
                disabled={it.state === 'wait' || it.state === 'busy' || it.state === 'skip'}
                onChange={(e) => onEdit(it.path, e.target.value)}
              />
              <div className="rename-caption">
                {it.state === 'wait' && <span className="muted">в очереди…</span>}
                {it.state === 'busy' && <span className="muted">{it.note || 'обрабатываю…'}</span>}
                {it.state === 'ready' && (it.caption || <span className="muted">без текста</span>)}
                {it.state === 'skip' && <span className="muted">{it.note || 'пропущено'}</span>}
                {it.state === 'failed' && <span className="err-text">⚠ {it.error}</span>}
                {it.state === 'renamed' && <span className="ok-text">переименован</span>}
                <span className="rename-orig"> был: {it.name}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
