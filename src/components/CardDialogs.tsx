import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Thumb } from './PhotoGrid';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import { exifDate } from '../lib/exif';
import { conflictLocalName } from '../lib/naming';
import { copyFile, deleteFile, exists, mkdirp, readBlob } from '../lib/localfs';
import { localDel, photoDel } from '../lib/db';
import type { PhotoRec } from '../types';

function fmtSize(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU');
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

/** Полная информация о файле: путь, размеры, даты, md5, ИИ-данные, крупное превью. */
export function FileInfoDialog({ rec, onClose }: { rec: PhotoRec; onClose: () => void }) {
  const app = useApp();
  const [live, setLive] = useState<{ created?: string; size?: number; md5?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [exif, setExif] = useState<number | undefined>(undefined);
  const [exifDone, setExifDone] = useState(false);

  // Для Диска — актуальные данные ресурса; для устройства — настоящая дата из EXIF.
  useEffect(() => {
    let cancelled = false;
    if (rec.source === 'disk' && app.api) {
      setLoading(true);
      app.api
        .resource(rec.path, false)
        .then((it) => {
          if (!cancelled) setLive({ created: it.created, size: it.size, md5: it.md5 });
        })
        .catch(() => {
          /* оставляем то, что есть в индексе */
        })
        .finally(() => !cancelled && setLoading(false));
    }
    if (rec.source === 'local') {
      void (async () => {
        try {
          // Для EXIF достаточно первых 256 КБ — не читаем большие файлы целиком.
          const head = (await readBlob(rec.path, rec.mime || 'image/jpeg')).slice(0, 262144);
          const ms = await exifDate(head);
          if (!cancelled) setExif(ms);
        } catch {
          /* без EXIF */
        } finally {
          if (!cancelled) setExifDone(true);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.path]);

  const modified = rec.source === 'local' && rec.mtime ? new Date(rec.mtime).toISOString() : rec.modified;
  const shotDate = rec.source === 'local' ? exif : live?.created;

  return (
    <Modal
      title="Свойства файла"
      onClose={onClose}
      wide
      footer={
        <button className="btn primary" onClick={onClose}>
          Закрыть
        </button>
      }
    >
      <div className="info-preview">
        <Thumb rec={rec} />
      </div>
      <div className="info-list">
        <Row label="Имя" value={<b>{rec.name}</b>} />
        <Row label="Путь" value={<code>{rec.path}</code>} />
        <Row label="Источник" value={rec.source === 'local' ? 'Файлы устройства' : 'Яндекс Диск'} />
        <Row label="Тип" value={rec.mime || '—'} />
        <Row label="Размер" value={fmtSize(live?.size ?? rec.size)} />
        <Row label="Изменён" value={fmtDate(modified)} />
        <Row
          label={rec.source === 'local' ? 'Дата съёмки (EXIF)' : 'Создан на Диске'}
          value={
            loading
              ? 'загружаю…'
              : shotDate
                ? fmtDate(typeof shotDate === 'string' ? shotDate : new Date(shotDate).toISOString())
                : rec.source === 'local'
                  ? exifDone
                    ? 'нет в EXIF — используется дата файла'
                    : 'определяю…'
                  : '—'
          }
        />
        <Row label="md5" value={live?.md5 || rec.md5 || '—'} />
        <Row
          label="ИИ-признаки"
          value={rec.emb && rec.emb.length ? `есть (поиск возможен)` : 'нет — файл не проанализирован'}
        />
        <Row label="Подпись ИИ" value={rec.caption || '—'} />
        <Row
          label="Лица"
          value={
            rec.faces && rec.faces.length
              ? `${rec.faces.length} шт.`
              : rec.facesDone
                ? 'не найдены'
                : 'не проверялось'
          }
        />
      </div>
    </Modal>
  );
}

/** Копирование одного файла: на Диск или по устройству. */
export function CopyDialog({ rec, onClose }: { rec: PhotoRec; onClose: () => void }) {
  const app = useApp();
  const device = useDevice();
  const isLocal = rec.source === 'local';
  const [target, setTarget] = useState(rec.dir || (isLocal ? '/' : 'disk:/'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const dir = target.trim().replace(/\/+$/, '');
    if (isLocal ? !dir.startsWith('/') : !dir.startsWith('disk:/')) {
      setErr(isLocal ? 'Путь должен быть абсолютным: /storage/emulated/0/…' : 'Путь должен начинаться с disk:/');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (isLocal) {
        await mkdirp(dir);
        // Подбираем свободное имя, чтобы не затирать чужой файл.
        let name = rec.name;
        let dest = `${dir}/${name}`;
        let attempt = 1;
        while (await exists(dest)) {
          name = conflictLocalName(rec.name, attempt++);
          dest = `${dir}/${name}`;
          if (attempt > 50) throw new Error('Слишком много одноимённых файлов в папке');
        }
        await copyFile(rec.path, dest);
        app.toast(`Скопировано: ${name}`, 'success');
        if (device.localPhotos.length) app.toast('Новая копия не в индексе — просканируйте папку', 'info');
      } else {
        if (!app.api) throw new Error('Нет подключения к Диску');
        const listing = await app.api.list(dir, { limit: 1000, preview: false });
        let name = rec.name;
        let attempt = 1;
        while (listing.items.some((i) => i.name === name)) {
          name = conflictLocalName(rec.name, attempt++);
          if (attempt > 50) throw new Error('Слишком много одноимённых файлов в папке');
        }
        await app.api.copy(rec.path, `${dir}/${name}`);
        app.toast(`Скопировано на Диск: ${name}`, 'success');
      }
      onClose();
    } catch (e) {
      setErr((e as Error)?.message || 'Ошибка копирования');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Копировать: ${rec.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Копирую…' : 'Копировать'}
          </button>
        </>
      }
    >
      <p className="muted">
        {isLocal
          ? 'Файл будет скопирован в папку на устройстве (оригинал остаётся на месте).'
          : 'Файл будет скопирован в папку на Диске (оригинал остаётся на месте).'}
      </p>
      <label className="field">
        <span>Папка назначения</span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          spellCheck={false}
          placeholder={isLocal ? '/storage/emulated/0/Фото' : 'disk:/Фото'}
        />
      </label>
      {err && <div className="error-text">{err}</div>}
    </Modal>
  );
}

/** Удаление одного файла: с Диска (в Корзину) или с устройства (бвозвратно). */
export function DeleteConfirm({ rec, onClose }: { rec: PhotoRec; onClose: () => void }) {
  const app = useApp();
  const device = useDevice();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isLocal = rec.source === 'local';

  const dropFromSelection = () => {
    const rest = [...app.selected.values()].filter((f) => f.path !== rec.path);
    app.replaceSelection(rest);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (isLocal) {
        await deleteFile(rec.path);
        await localDel([rec.path]);
        await device.reloadLocal();
      } else {
        if (!app.api) throw new Error('Нет подключения к Диску');
        await app.api.delete(rec.path);
        await photoDel([rec.path]);
        await app.reloadPhotos();
      }
      dropFromSelection();
      app.toast(isLocal ? 'Файл удалён с устройства' : 'Файл перемещён в Корзину Диска', 'success');
      onClose();
    } catch (e) {
      setErr((e as Error)?.message || 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isLocal ? 'Удалить файл?' : 'Удалить файл с Диска?'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className="btn danger" onClick={submit} disabled={busy}>
            {busy ? 'Удаляю…' : 'Удалить'}
          </button>
        </>
      }
    >
      <p className="muted">
        <b>{rec.name}</b>
        <br />
        <code className="break">{rec.path}</code>
      </p>
      <p className="err-text">
        {isLocal
          ? 'Файл будет удалён с устройства без возможности вернуть его через приложение.'
          : 'Файл будет перемещён в Корзину Яндекс Диска (восстановление — на самом Диске).'}
      </p>
      {err && <div className="error-text">{err}</div>}
    </Modal>
  );
}
