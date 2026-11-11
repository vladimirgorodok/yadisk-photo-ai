import { useState } from 'react';
import type { SelectedFile } from '../types';
import { useApp } from '../state/AppContext';
import { Modal } from './Modal';

export function MoveDialog({
  files,
  defaultPath,
  title,
  onClose,
  onDone,
}: {
  files: SelectedFile[];
  defaultPath: string;
  title: string;
  onClose: () => void;
  onDone?: (movedFrom: string[]) => void;
}) {
  const app = useApp();
  const [path, setPath] = useState(defaultPath);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const target = path.trim().replace(/\/+$/, '');
    if (!target.startsWith('disk:/')) {
      setErr('Путь должен начинаться с disk:/ (например, disk:/Фото/Отпуск)');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await app.moveMany(files, target, overwrite);
      if (res.moved.length) onDone?.(res.moved.map((m) => m.from));
      if (!res.moved.length && res.failed.length) {
        setErr(res.failed[0].error);
      } else {
        onClose();
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
      </p>
      <label className="field">
        <span>Папка назначения</span>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="disk:/AI-Группы/Лицо 1" />
      </label>
      <label className="checkline">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        <span>Заменять существующие файлы с такими же именами</span>
      </label>
      {err && <div className="error-text">{err}</div>}
    </Modal>
  );
}
