import { useDevice } from '../state/DeviceContext';
import { formatBytes } from '../lib/util';
import type { TransferJob } from '../types';

const STATUS: Record<TransferJob['status'], { label: string; cls: string }> = {
  queued: { label: 'в очереди', cls: 'st-queued' },
  running: { label: 'переношу…', cls: 'st-running' },
  paused: { label: 'на паузе', cls: 'st-paused' },
  done: { label: 'готово', cls: 'st-done' },
  error: { label: 'ошибка', cls: 'st-error' },
  canceled: { label: 'отменено', cls: 'st-canceled' },
};

function jobRow(job: TransferJob, device: ReturnType<typeof useDevice>) {
  const st = STATUS[job.status];
  const pct =
    job.bytesTotal > 0 ? Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100)) : 0;
  const active = job.status === 'running';
  const canCancel = job.status === 'queued' || job.status === 'error';
  return (
    <div className="job" key={job.id}>
      <span className="job-kind" aria-hidden>
        {job.kind === 'download' ? '⬇️' : '⬆️'}
      </span>
      <div className="job-main">
        <div className="job-name" title={`${job.src} → ${job.dst}`}>
          {job.name}
        </div>
        <div className="job-sub">
          <span className={st.cls}>{st.label}</span>
          {job.bytesTotal > 0 && (
            <>
              {' · '}
              {formatBytes(job.bytesDone)} / {formatBytes(job.bytesTotal)}
              {pct > 0 && ` (${pct}%)`}
            </>
          )}
          {job.error && <span className="err-text"> · {job.error}</span>}
          {!job.error && job.note && <span className="muted"> · {job.note}</span>}
        </div>
        {(active || (job.bytesTotal > 0 && job.status === 'queued')) && (
          <div className="bar-wrap slim">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="job-actions">
        {(job.status === 'error' || job.status === 'canceled') && (
          <button
            className="icon-btn"
            title="Повторить"
            onClick={() => void device.retryTransfer(job.id)}
          >
            ↻
          </button>
        )}
        {canCancel && (
          <button
            className="icon-btn"
            title="Убрать из очереди"
            onClick={() => void device.cancelTransfer(job.id)}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** Список задач очереди «Трансфер» с прогрессом и управлением. */
export function TransferPanel() {
  const device = useDevice();
  const jobs = device.jobs;
  if (!device.supported || !jobs.length) return null;

  const active = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running' || j.status === 'error',
  ).length;
  const finished = jobs.length - active;

  return (
    <section className="transfer">
      <div className="results-head">
        <div className="results-title">
          🚚 Трансфер <span className="muted">({active ? `активных: ${active}` : `завершённых: ${finished}`})</span>
        </div>
        <div className="results-actions">
          <button className="btn ghost sm" onClick={device.togglePause}>
            {device.transferPaused ? '▶ Продолжить' : '⏸ Пауза'}
          </button>
          <button
            className="btn ghost sm"
            onClick={() => void device.clearFinished()}
            disabled={!finished}
          >
            Очистить завершённые
          </button>
        </div>
      </div>
      {device.transferPaused && (
        <div className="muted small-note">
          На паузе: текущий файл докачивается, новые не начинаются.
        </div>
      )}
      <div className="transfer-list">{jobs.map((j) => jobRow(j, device))}</div>
    </section>
  );
}
