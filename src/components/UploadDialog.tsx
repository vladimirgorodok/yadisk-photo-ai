import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import type { PhotoRec } from '../types';

const POLICIES: { key: 'skip' | 'rename' | 'overwrite'; label: string; hint: string }[] = [
  { key: 'skip', label: 'Пропустить', hint: 'если имя уже есть — не трогать' },
  { key: 'rename', label: 'Переименовать', hint: 'добавить «(1)», «(2)»' },
  { key: 'overwrite', label: 'Заменить', hint: 'перезаписать существующий файл' },
];

/** «Залить на Диск»: копия локальных файлов в папку Яндекс Диска с проверкой md5. */
export function UploadDialog({ files, onClose }: { files: PhotoRec[]; onClose: () => void }) {
  const app = useApp();
  const device = useDevice();
  const [dir, setDir] = useState(app.settings.uploadDir);
  const [policy, setPolicy] = useState(app.settings.conflictPolicy);
  const [deleteLocal, setDeleteLocal] = useState(false);
  const [topDirs, setTopDirs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!app.api) return;
    app.api
      .list('disk:/', { limit: 1000, preview: false })
      .then((res) =>
        setTopDirs(res.items.filter((i) => i.type === 'dir').map((i) => i.path)),
      )
      .catch(() => setTopDirs([]));
  }, [app.api]);

  const start = async () => {
    const target = dir.trim().replace(/\/+$/, '') || 'disk:/';
    if (!target.startsWith('disk:')) {
      app.toast('Путь должен начинаться с disk:', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await device.uploadTo(
        files.map((f) => ({ path: f.path, name: f.name, size: f.size })),
        target,
        deleteLocal,
      );
      app.updateSettings({ uploadDir: target, conflictPolicy: policy });
      if (res.added) app.toast(`В очередь добавлено: ${res.added}`, 'success');
      if (res.skipped)
        app.toast(`Пропущено (уже есть на Диске): ${res.skipped} — ${res.skippedNames.slice(0, 3).join(', ')}`, 'info');
      onClose();
    } catch (e) {
      app.toast((e as Error)?.message || 'Не удалось добавить в очередь', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Загрузить на Диск (${files.length})`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className="btn primary" onClick={start} disabled={busy || !files.length}>
            {busy ? 'Добавляю…' : 'В очередь'}
          </button>
        </>
      }
    >
      <p className="muted">
        Файлы копируются на Диск в выбранную папку. После передачи <b>md5 сверяется</b> — при
        расхождении файл перезаливается автоматически.
      </p>
      <div className="field">
        <label>Папка на Диске</label>
        <input
          className="path-box"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          spellCheck={false}
          placeholder="disk:/Моя папка"
        />
        {topDirs.length > 0 && (
          <div className="path-chips">
            {topDirs.slice(0, 8).map((p) => (
              <button key={p} className={`chip ${dir === p ? 'on' : ''}`} onClick={() => setDir(p)}>
                {p.replace('disk:/', '')}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="field">
        <label>Если файл с таким именем уже есть</label>
        <div className="path-chips">
          {POLICIES.map((p) => (
            <button
              key={p.key}
              className={`chip ${policy === p.key ? 'on' : ''}`}
              title={p.hint}
              onClick={() => setPolicy(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <label className="checkline">
        <input
          type="checkbox"
          checked={deleteLocal}
          onChange={(e) => setDeleteLocal(e.target.checked)}
        />
        <span>
          Удалить локальные копии <b>после проверки md5</b> (эффект перемещения, но безопасно)
        </span>
      </label>
      <ul className="dl-list">
        {files.slice(0, 8).map((f) => (
          <li key={f.path} title={f.path}>
            {f.name}
          </li>
        ))}
        {files.length > 8 && <li className="muted">… и ещё {files.length - 8}</li>}
      </ul>
    </Modal>
  );
}
