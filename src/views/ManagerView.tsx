import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import { TransferPanel } from '../components/TransferPanel';
import { DownloadDialog } from '../components/DownloadDialog';
import { UploadDialog } from '../components/UploadDialog';
import { DirBrowser, useLocalDir } from '../components/DirBrowser';
import { guessMime, walkAllFiles } from '../lib/localfs';
import { isAbort } from '../lib/util';
import type { DeviceFile } from '../lib/localfs';
import type { PhotoRec } from '../types';
import type { YItem } from '../lib/api';

type Seg = 'queue' | 'disk' | 'device';

/** YItem → PhotoRec (для диалогов очереди, используются path/name/md5). */
function yToRec(it: YItem): PhotoRec {
  const dir = it.path.replace(/\/[^/]+$/, '') || 'disk:/';
  return {
    path: it.path,
    name: it.name,
    dir,
    size: it.size ?? 0,
    modified: it.modified ?? '',
    md5: it.md5 ?? '',
    mime: it.mime_type || it.media_type || 'image/jpeg',
    source: 'disk',
    preview: it.preview,
  };
}

/** DeviceFile → PhotoRec (для диалога загрузки на Диск). */
function dToRec(f: DeviceFile): PhotoRec {
  return {
    path: f.path,
    name: f.name,
    dir: f.dir,
    size: f.size,
    modified: f.mtime ? new Date(f.mtime).toISOString() : '',
    md5: '',
    mime: guessMime(f.name),
    source: 'local',
    mtime: f.mtime,
  };
}

/**
 * «Менеджер»: работа с файлами и папками для взаимодействия
 * Яндекс Диска и устройства — очередь переноса и два направления.
 */
export function ManagerView() {
  const [seg, setSeg] = useState<Seg>('queue');
  return (
    <div className="view">
      <div className="segmented" role="tablist" aria-label="Менеджер">
        <button role="tab" aria-selected={seg === 'queue'} className={seg === 'queue' ? 'on' : ''} onClick={() => setSeg('queue')}>
          📦 Очередь
        </button>
        <button role="tab" aria-selected={seg === 'disk'} className={seg === 'disk' ? 'on' : ''} onClick={() => setSeg('disk')}>
          ⬇ С Диска
        </button>
        <button role="tab" aria-selected={seg === 'device'} className={seg === 'device' ? 'on' : ''} onClick={() => setSeg('device')}>
          ⬆ На Диск
        </button>
      </div>
      {seg === 'queue' && <QueueSegment />}
      {seg === 'disk' && <FromDiskSegment />}
      {seg === 'device' && <ToDeviceSegment />}
    </div>
  );
}

function QueueSegment() {
  const device = useDevice();
  const active = device.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  return (
    <>
      <div className="hero-card">
        <div className="hero-emoji">🚚</div>
        <h2>Перенос Диск ↔ Устройство</h2>
        <p className="muted">
          Файлы копируются по очереди с проверкой md5; очередь переживает перезапуск приложения.
          Павуза ставится после текущего файла. Выберите направление на вкладках «С Диска» и
          «На Диск» — или запускайте действия прямо из результатов поиска и браузера устройства.
        </p>
        {active > 0 && (
          <p className="muted">
            Сейчас в работе: <b>{active}</b>
          </p>
        )}
      </div>
      <TransferPanel />
    </>
  );
}

/** Выбор файлов на Диске → очередь скачивания на устройство. */
function FromDiskSegment() {
  const app = useApp();
  const [path, setPath] = useState('disk:/');
  const [input, setInput] = useState('disk:/');
  const [items, setItems] = useState<YItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [walkNote, setWalkNote] = useState<string | null>(null);
  const [walkBusy, setWalkBusy] = useState(false);
  const walkAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => walkAbortRef.current?.abort(), []);

  const load = async (p: string) => {
    const target = p.trim() || 'disk:/';
    if (!app.api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await app.api.list(target, { limit: 500, preview: false });
      setItems(res.items);
      setPath(target);
      setInput(target);
      setSelected(new Set());
      app.updateSettings({ lastFolder: target });
    } catch (e) {
      setItems(null);
      setError((e as Error)?.message || 'Не удалось прочитать папку');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (it: YItem) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(it.path)) next.delete(it.path);
      else next.add(it.path);
      return next;
    });

  /** Выделить все файлы текущей папки (без подпапок). */
  const selectHere = () => {
    const next = new Set(selected);
    for (const it of items ?? []) if (it.type === 'file') next.add(it.path);
    setSelected(next);
  };

  /** Выделить все файлы папки, включая подпапки (лимит — 3000 файлов). */
  const selectTree = async () => {
    const api = app.api;
    if (!api || walkBusy) return;
    const ctrl = new AbortController();
    walkAbortRef.current = ctrl;
    setWalkBusy(true);
    setWalkNote('Обхожу папки…');
    const LIMIT = 3000;
    try {
      const found = new Set<string>();
      const stack = [path];
      const seen = new Set([path]);
      let done = 0;
      while (stack.length && !ctrl.signal.aborted) {
        const dir = stack.pop()!;
        const res = await api.list(dir, { limit: 500, preview: false });
        done++;
        for (const it of res.items) {
          if (it.type === 'file') found.add(it.path);
          else if (it.type === 'dir' && !seen.has(it.path) && found.size < LIMIT) {
            seen.add(it.path);
            stack.push(it.path);
          }
        }
        setWalkNote(`Обхожу папки: ${done} · файлов: ${found.size}`);
        if (found.size >= LIMIT) break;
      }
      if (ctrl.signal.aborted) return;
      setSelected((prev) => new Set([...prev, ...found]));
      if (found.size >= LIMIT) {
        setWalkNote(`Выделено (лимит ${LIMIT}): ${found.size}`);
      } else {
        setWalkNote(null);
        app.toast(`Выделено файлов: ${found.size}`, 'success');
      }
    } catch (e) {
      setWalkNote(null);
      app.toast((e as Error)?.message || 'Не удалось обойти папки', 'error');
    } finally {
      setWalkBusy(false);
      walkAbortRef.current = null;
    }
  };

  const picked: PhotoRec[] = useMemo(
    () => (items ?? []).filter((i) => i.type === 'file' && selected.has(i.path)).map(yToRec),
    [items, selected],
  );

  if (!app.api || !app.connected) {
    return (
      <div className="hero-card">
        <div className="hero-emoji">🔗</div>
        <h2>Подключите Яндекс Диск</h2>
        <p className="muted">Скачивание файлов с Диска доступно после подключения в настройках.</p>
      </div>
    );
  }

  return (
    <section className="search-box">
      <div className="search-row">
        <input
          className="path-box"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(input);
          }}
          spellCheck={false}
          placeholder="disk:/Папка"
        />
        <button className="btn ghost" onClick={() => void load(input)} disabled={loading}>
          {loading ? '…' : 'Открыть'}
        </button>
        <button
          className="btn ghost"
          title="Наверх"
          onClick={() => void load(path.replace(/\/[^/]+\/?$/, '') || 'disk:/')}
          disabled={path === 'disk:/'}
        >
          ↑
        </button>
      </div>
      <div className="chips">
        <button className={`chip ${path === 'disk:/' ? 'on' : ''}`} onClick={() => void load('disk:/')}>
          Корень Диска
        </button>
      </div>

      {items && (
        <div className="chips">
          <button
            className="chip"
            onClick={selectHere}
            disabled={walkBusy || !items.some((i) => i.type === 'file')}
          >
            ☑ Все файлы папки ({items.filter((i) => i.type === 'file').length})
          </button>
          <button className="chip" onClick={() => void selectTree()} disabled={walkBusy}>
            {walkBusy ? '⏳ Обхожу…' : '☑ Включая подпапки'}
          </button>
        </div>
      )}
      {walkNote && (
        <div className="index-line">
          <span className="muted">{walkNote}</span>
        </div>
      )}

      {error && (
        <div className="index-line">
          <span className="err-text">⚠ {error}</span>
        </div>
      )}

      {items && (
        <ul className="file-list">
          {items.map((it) =>
            it.type === 'dir' ? (
              <li key={it.path}>
                <button className="file-row dir" onClick={() => void load(it.path)} title={it.path}>
                  <span>📁</span>
                  <span className="file-name">{it.name}</span>
                </button>
              </li>
            ) : (
              <li key={it.path}>
                <label className="file-row" title={it.path}>
                  <input type="checkbox" checked={selected.has(it.path)} onChange={() => toggle(it)} />
                  <span className="file-name">{it.name}</span>
                  <span className="muted file-meta">
                    {it.size ? `${(it.size / 1024 / 1024).toFixed(1)} МБ` : ''}
                    {it.modified ? ` · ${it.modified.slice(0, 10)}` : ''}
                  </span>
                </label>
              </li>
            ),
          )}
          {items.length === 0 && <li className="muted">Папка пуста</li>}
        </ul>
      )}

      <div className="index-line">
        <span className="muted">
          Выделено файлов: <b>{picked.length}</b> · папка на устройстве: <b>{app.settings.downloadDir}</b>
        </span>
        <span className="index-actions">
          {picked.length > 0 && (
            <button className="btn primary sm" onClick={() => setDialogOpen(true)}>
              ⬇ В очередь скачивания ({picked.length})
            </button>
          )}
          {selected.size > 0 && (
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
              Снять
            </button>
          )}
        </span>
      </div>

      {dialogOpen && (
        <DownloadDialog
          files={picked}
          onClose={() => {
            setDialogOpen(false);
            setSelected(new Set());
          }}
        />
      )}
    </section>
  );
}

/** Выбор файлов на устройстве → очередь загрузки на Диск. */
function ToDeviceSegment() {
  const app = useApp();
  const device = useDevice();
  const dir = useLocalDir(app.settings.localRoot);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [walkNote, setWalkNote] = useState<string | null>(null);
  const [walkBusy, setWalkBusy] = useState(false);
  const bootRef = useRef(false);
  const walkAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => walkAbortRef.current?.abort(), []);

  // Первый вход: открываем последнюю папку, когда доступ выдан.
  useEffect(() => {
    if (device.access !== 'granted' || bootRef.current) return;
    bootRef.current = true;
    void dir.load(dir.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.access]);

  const toggle = (f: DeviceFile) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(f.path)) next.delete(f.path);
      else next.add(f.path);
      return next;
    });

  const files = dir.listing?.files ?? [];

  /** Выделить все файлы текущей папки (без подпапок). */
  const selectHere = () => {
    const next = new Set(selected);
    for (const f of files) next.add(f.path);
    setSelected(next);
  };

  /** Выделить все файлы папки, включая подпапки. */
  const selectTree = async () => {
    if (walkBusy) return;
    const ctrl = new AbortController();
    walkAbortRef.current = ctrl;
    setWalkBusy(true);
    setWalkNote('Обхожу папки…');
    try {
      const found = await walkAllFiles(dir.path, ctrl.signal, (p) =>
        setWalkNote(`${p.done}/${p.total} папок · ${p.detail}`),
      );
      if (ctrl.signal.aborted) return;
      setSelected((prev) => new Set([...prev, ...found.map((f) => f.path)]));
      setWalkNote(null);
      app.toast(`Выделено файлов: ${found.length}`, 'success');
    } catch (e) {
      setWalkNote(null);
      if (!isAbort(e)) app.toast((e as Error)?.message || 'Не удалось обойти папки', 'error');
    } finally {
      setWalkBusy(false);
      walkAbortRef.current = null;
    }
  };

  const picked: PhotoRec[] = useMemo(
    () => files.filter((f) => selected.has(f.path)).map(dToRec),
    [files, selected],
  );

  if (!device.supported) {
    return (
      <div className="hero-card">
        <div className="hero-emoji">📱</div>
        <h2>Файлы устройства — в APK</h2>
        <p className="muted">Загрузка файлов с устройства на Диск доступна в Android-приложении.</p>
      </div>
    );
  }
  if (device.access !== 'granted') {
    return (
      <div className="hero-card">
        <div className="hero-emoji">🔐</div>
        <h2>Нужен доступ к файлам</h2>
        <p className="muted">Выдайте доступ «Все файлы» в разделе «Устройство», затем вернитесь сюда.</p>
      </div>
    );
  }

  return (
    <>
      <DirBrowser
        dir={dir}
        selectable
        selected={selected}
        onToggle={toggle}
      >
        <button
          className="btn ghost sm"
          onClick={selectHere}
          disabled={walkBusy || !files.length}
        >
          ☑ Все файлы ({files.length})
        </button>
        <button className="btn ghost sm" onClick={() => void selectTree()} disabled={walkBusy}>
          {walkBusy ? '⏳ Обхожу…' : '☑ Включая подпапки'}
        </button>
        {picked.length > 0 && (
          <button className="btn primary sm" onClick={() => setDialogOpen(true)}>
            ⬆ В очередь загрузки ({picked.length})
          </button>
        )}
        {selected.size > 0 && (
          <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
            Снять
          </button>
        )}
      </DirBrowser>
      {walkNote && (
        <div className="index-line">
          <span className="muted">{walkNote}</span>
        </div>
      )}
      {dialogOpen && (
        <UploadDialog
          files={picked}
          onClose={() => {
            setDialogOpen(false);
            setSelected(new Set());
          }}
        />
      )}
    </>
  );
}
