import { useState } from 'react';
import type { SelectedFile } from '../types';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import { deleteFile, exists, mkdirp } from '../lib/localfs';
import { Modal } from './Modal';

/**
 * Перемещение файлов. Режим disk — папка на Яндекс Диске (moveMany),
 * режим local — перемещение по устройству через renameLocal (с журналом
 * и откатом кнопкой ↶).
 */
export function MoveDialog({
  files,
  defaultPath,
  title,
  onClose,
  onDone,
  mode = 'disk',
}: {
  files: SelectedFile[];
  defaultPath: string;
  title: string;
  onClose: () => void;
  onDone?: (movedFrom: string[]) => void;
  mode?: 'disk' | 'local';
}) {
  const app = useApp();
  const device = useDevice();
  const [path, setPath] = useState(defaultPath);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isLocal = mode === 'local';

  const submit = async () => {
    const target = path.trim().replace(/\/+$/, '');
    if (isLocal) {
      if (!target.startsWith('/')) {
        setErr('Путь должен быть абсолютным, например /storage/emulated/0/Фото');
        return;
      }
    } else if (!target.startsWith('disk:/')) {
      setErr('Путь должен начинаться с disk:/ (например, disk:/Фото/Отпуск)');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (isLocal) {
        await mkdirp(target);
        const pairs = new Map<string, string>();
        for (const f of files) {
          const dest = `${target}/${f.name}`;
          if (overwrite && f.path !== dest && (await exists(dest))) await deleteFile(dest);
          pairs.set(f.path, dest);
        }
        const res = await device.renameLocal(pairs);
        if (!res.done) {
          setErr(res.failed[0]?.error || 'Ничего не перемещено');
        } else {
          if (res.failed.length) app.toast(`Перемещено: ${res.done}, ошибок: ${res.failed.length}`, 'info');
          else app.toast(`Перемещено файлов: ${res.done}`, 'success');
          onDone?.(files.map((f) => f.path));
          onClose();
        }
      } else {
        const res = await app.moveMany(files, target, overwrite);
        if (res.moved.length) onDone?.(res.moved.map((m) => m.from));
        if (!res.moved.length && res.failed.length) {
          setErr(res.failed[0].error);
        } else {
          onClose();
        }
      }
    } catch (e) {
      setErr((e as Error)?.message || 'Ошибка перемещения');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Перемещаю…' : `Переместить (${files.length})`}
          </button>
        </>
      }
    >
      <p className="muted">
        Файлов: <b>{files.length}</b>. Папка будет создана автоматически, если её ещё нет. При совпадении
        имён файлы получат суффикс «(1)».
        {isLocal && ' Перемещение на устройстве отменяется кнопкой ↶ в разделе «Устройство».'}
      </p>
      <label className="field">
        <span>Папка назначения</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={isLocal ? '/storage/emulated/0/Фото' : 'disk:/AI-Группы/Лицо 1'}
          spellCheck={false}
        />
      </label>
      <label className="checkline">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        <span>Заменять существующие файлы с такими же именами</span>
      </label>
      {err && <div className="error-text">{err}</div>}
    </Modal>
  );
}
