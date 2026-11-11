import type { Progress } from '../types';

export function ProgressPanel({
  progress,
  log,
  onCancel,
}: {
  progress: Progress;
  log?: string[];
  onCancel?: () => void;
}) {
  const pct =
    progress.total > 1 ? Math.round(Math.min(1, progress.done / progress.total) * 100) : undefined;
  return (
    <div className="progress-panel">
      <div className="pp-head">
        <div className="pp-title">
          <span className="pulse" />
          {progress.label}
        </div>
        {onCancel && (
          <button className="btn ghost sm" onClick={onCancel}>
            Отменить
          </button>
        )}
      </div>
      {progress.detail && <div className="pp-detail">{progress.detail}</div>}
      <div className={`bar ${pct === undefined ? 'indeterminate' : ''}`}>
        <div className="bar-fill" style={{ width: pct !== undefined ? `${pct}%` : '35%' }} />
      </div>
      {pct !== undefined && (
        <div className="pp-meta">
          {progress.done} / {progress.total} · {pct}%
        </div>
      )}
      {log && log.length > 0 && (
        <div className="pp-log">
          {log.slice(-4).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
