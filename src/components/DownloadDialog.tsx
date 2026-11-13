import { useState } from 'react';
import { Modal } from './Modal';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import type { PhotoRec } from '../types';

/**
 * «Скачать на устройство»: копия файлов с Диска в папку устройства.
 * Оригиналы остаются на Диске; опционально — удалить после проверки md5.
 */
export function DownloadDialog({ files, onClose }: { files: PhotoRec[]; onClose: () => void }) {
  const app = useApp();
  const device = useDevice();
  const [dir, setDir] = useState(app.settings.downloadDir);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    const target = dir.trim();
    if (!target.startsWith('/')) {
      app.toast('Укажите путь на устройстве, например /storage/emulated/0/Download/Фото', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await device.downloadTo(
        files.map((f) => ({ path: f.path, name: f.name, size: f.size, md5: f.md5 })),
        target,
        deleteAfter,
      );
      app.updateSettings({ downloadDir: target });
      if (res.added) app.toast(`В очередь добавлено: ${res.added}`, 'success');
      if (res.skipped) app.toast(`Пропущено (нет свободных имён): ${res.skipped}`, 'info');
      onClose();
    } catch (e) {
      app.toast((e as Error)?.message || 'Не удалось добавить в очередь', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Скачать на устройство (${files.length})`}
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
        Файлы будут <b>скопированы</b> в папку устройства — оригиналы останутся на Диске. Качается
        по одному, очередь переживает перезапуск приложения.
      </p>
      <div className="field">
        <label>Папка на устройстве</label>
        <input
          className="path-box"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          spellCheck={false}
          placeholder="/storage/emulated/0/Download/…"
        />
      </div>
      <label className="checkline">
        <input
          type="checkbox"
          checked={deleteAfter}
          onChange={(e) => setDeleteAfter(e.target.checked)}
        />
        <span>
          Удалить оригиналы с Диска <b>после проверки md5</b> (эффект перемещения, но безопасно)
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
