import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useApp } from './AppContext';
import {
  checkAccess,
  requestAccess,
  isDeviceNative,
  walkImages,
  readBlob,
  makeThumb,
  dropLocalThumbUrl,
  clearLocalThumbUrls,
  joinLocal,
  parentLocal,
  baseName,
  renameFile,
  exists,
} from '../lib/localfs';
import { localEntries, localSet, localSetMany, localDel, localClear, kvGet, kvSet } from '../lib/db';
import { embedImage } from '../lib/ai';
import { isAbort } from '../lib/util';
import {
  initTransfer,
  loadJobs,
  resumeQueue,
  subscribeTransfer,
  setTransferPaused,
  cancelJob,
  retryJob,
  clearFinishedJobs,
  enqueueDownloads,
  enqueueUploads,
  type ConflictPolicy,
  type DownloadRequest,
  type UploadRequest,
  type EnqueueResult,
} from '../lib/transfer';
import type { IndexMeta, PhotoRec, Progress, TransferJob } from '../types';

export interface CaptionStatus {
  pct: number;
  msg: string;
}

export interface RenameJournalEntry {
  from: string;
  to: string;
  at: number;
}

interface DeviceCtx {
  supported: boolean;
  access: 'granted' | 'denied' | 'unknown';
  refreshAccess: () => Promise<void>;
  grantAccess: () => Promise<boolean>;

  localPhotos: PhotoRec[];
  localScanAt: number | null;
  localScanning: boolean;
  localProgress: Progress | null;
  localProgressLog: string[];
  scanLocal: (root: string) => Promise<void>;
  cancelLocalScan: () => void;
  reloadLocal: () => Promise<void>;
  clearLocalIndex: () => Promise<void>;

  renameLocal: (pairs: Map<string, string>) => Promise<{ done: number; failed: { from: string; error: string }[] }>;
  renameJournal: RenameJournalEntry[];
  undoRenames: () => Promise<{ done: number; failed: number }>;
  captionStatus: CaptionStatus | null;
  setCaptionStatus: (s: CaptionStatus | null) => void;

  jobs: TransferJob[];
  transferPaused: boolean;
  downloadTo: (reqs: DownloadRequest[], targetDir: string, deleteAfter: boolean) => Promise<EnqueueResult>;
  uploadTo: (reqs: UploadRequest[], diskDir: string, deleteLocal: boolean) => Promise<EnqueueResult & { skippedNames: string[] }>;
  togglePause: () => void;
  cancelTransfer: (id: string) => Promise<void>;
  retryTransfer: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
}

const Ctx = createContext<DeviceCtx | null>(null);

export function useDevice(): DeviceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDevice вне провайдера');
  return ctx;
}

const JOURNAL_KEY = 'renameJournal';
const LOCAL_META_KEY = 'localMeta';
const MAX_JOURNAL = 300;

export function DeviceProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const [access, setAccess] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [localPhotos, setLocalPhotos] = useState<PhotoRec[]>([]);
  const [localScanAt, setLocalScanAt] = useState<number | null>(null);
  const [localScanning, setLocalScanning] = useState(false);
  const [localProgress, setLocalProgress] = useState<Progress | null>(null);
  const [localProgressLog, setLocalProgressLog] = useState<string[]>([]);
  const [renameJournal, setRenameJournal] = useState<RenameJournalEntry[]>([]);
  const [captionStatus, setCaptionStatus] = useState<CaptionStatus | null>(null);
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [transferPaused, setTransferPausedState] = useState(false);
  const localRef = useRef<PhotoRec[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scanningRef = useRef(false);
  const lastLogRef = useRef('');

  const supported = isDeviceNative;

  // --- Доступ к файлам ---
  const refreshAccess = useCallback(async () => {
    if (!supported) {
      setAccess('denied');
      return;
    }
    const res = await checkAccess();
    setAccess(res.granted ? 'granted' : 'denied');
  }, [supported]);

  const grantAccess = useCallback(async () => {
    const res = await requestAccess();
    // На Android 11+ пользователь уходит в настройки — перепроверим при возврате.
    const after = await checkAccess();
    setAccess(after.granted ? 'granted' : 'denied');
    if (!res.opened && res.error) app.toast(res.error, 'error');
    return after.granted;
  }, [app]);

  // --- Индекс устройства ---
  const reloadLocal = useCallback(async () => {
    const entries = await localEntries();
    const list = entries.map(([, rec]) => rec);
    localRef.current = list;
    setLocalPhotos(list);
  }, []);

  useEffect(() => {
    (async () => {
      if (!supported) return;
      try {
        await refreshAccess();
        await reloadLocal();
        const meta = await kvGet<IndexMeta>(LOCAL_META_KEY);
        if (meta?.scanAt) setLocalScanAt(meta.scanAt);
        const journal = await kvGet<RenameJournalEntry[]>(JOURNAL_KEY);
        if (journal) setRenameJournal(journal);
        await loadJobs();
        setTransferPausedState(false);
        // задачи из прошлой сессии: очередь уже загружена, API инициализирован
        if (app.api) resumeQueue();
      } catch (e) {
        console.warn('Не удалось загрузить индекс устройства', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // Подписка на очередь трансфера
  useEffect(() => {
    if (!supported) return;
    return subscribeTransfer(setJobs);
  }, [supported]);

  // API для очереди (смена токена/подключения) + возобновление после перезапуска
  useEffect(() => {
    if (!supported) return;
    initTransfer(app.api);
    if (app.api) resumeQueue();
  }, [app.api, supported]);

  const pushLocalProgress = useCallback((p: Progress) => {
    setLocalProgress(p);
    const line = p.detail ? `${p.label} — ${p.detail}` : p.label;
    if (line !== lastLogRef.current) {
      lastLogRef.current = line;
      setLocalProgressLog((prev) => [...prev.slice(-7), line]);
    }
  }, []);

  const scanLocal = useCallback(
    async (root: string) => {
      if (!supported || access !== 'granted') {
        app.toast('Сначала выдайте доступ к файлам устройства', 'error');
        return;
      }
      if (scanningRef.current) return;
      scanningRef.current = true;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLocalScanning(true);
      setLocalProgressLog([]);
      lastLogRef.current = '';
      pushLocalProgress({ label: 'Сканирую папки устройства', done: 0, total: 1, detail: root });
      try {
        const old = new Map(localRef.current.map((r) => [r.path, r]));
        const files = await walkImages(root, ctrl.signal, pushLocalProgress);

        // Базовые записи: неизменные файлы сохраняем вместе с миниатюрами и эмбеддингами.
        const recs: PhotoRec[] = files.map((f) => {
          const prev = old.get(f.path);
          if (prev && prev.size === f.size && prev.mtime === f.mtime) return prev;
          return {
            path: f.path,
            name: f.name,
            dir: f.dir,
            size: f.size,
            modified: f.mtime ? new Date(f.mtime).toISOString() : '',
            md5: '',
            mime: '',
            source: 'local',
            mtime: f.mtime,
          };
        });
        for (let i = 0; i < recs.length; i += 60) {
          if (ctrl.signal.aborted) throw abortErrorLocal();
          await localSetMany(recs.slice(i, i + 60));
        }
        localRef.current = recs;
        setLocalPhotos([...recs]);

        // ИИ-анализ: миниатюра + CLIP-эмбеддинг для новых/изменённых файлов.
        const todo = recs.filter((r) => !r.emb || !r.thumb);
        if (todo.length) {
          pushLocalProgress({ label: 'Загружаю ИИ-модели', done: 0, total: 1 });
          await app.preload();
          let failed = 0;
          for (let i = 0; i < todo.length; i++) {
            if (ctrl.signal.aborted) throw abortErrorLocal();
            const rec = todo[i];
            pushLocalProgress({
              label: 'ИИ анализирует файлы устройства',
              done: i,
              total: todo.length,
              detail: rec.name,
            });
            try {
              if (!rec.thumb || !rec.emb) {
                const blob = await readBlob(rec.path, rec.mime || 'image/jpeg');
                if (!rec.thumb) rec.thumb = await makeThumb(blob);
                try {
                  if (!rec.emb) {
                    rec.emb = await embedImage(rec.thumb ?? blob);
                    rec.embModel = app.settings.modelKey;
                    rec.embAt = Date.now();
                  }
                } catch (e2) {
                  if (isAbort(e2)) throw e2;
                  // без эмбеддинга (например, формат не поддерживается) — миниатюру сохраняем
                }
                await localSet(rec);
              }
            } catch (e) {
              if (isAbort(e)) throw e;
              failed++;
              if (failed === 1) console.warn('Не удалось проанализировать', rec.path, e);
            }
            // освобождаем кадр для UI
            await new Promise((r) => setTimeout(r, 0));
          }
          pushLocalProgress({
            label: 'ИИ анализирует файлы устройства',
            done: todo.length,
            total: todo.length,
            detail: failed ? `Не удалось обработать: ${failed}` : 'Готово',
          });
          // записи мутированы на месте — фиксируем итоговый список
          setLocalPhotos([...recs]);
        }

        const meta: IndexMeta = { scanAt: Date.now(), count: recs.length, modelKey: app.settings.modelKey };
        await kvSet(LOCAL_META_KEY, meta);
        setLocalScanAt(meta.scanAt);
        app.toast(
          recs.length ? `Устройство: найдено ${recs.length} изображений` : 'Изображений не найдено',
          'success',
        );
      } catch (e) {
        if (!isAbort(e)) app.toast((e as Error)?.message || 'Ошибка сканирования устройства', 'error');
      } finally {
        scanningRef.current = false;
        abortRef.current = null;
        setLocalScanning(false);
        setLocalProgress(null);
      }
    },
    [supported, access, app, pushLocalProgress],
  );

  const cancelLocalScan = useCallback(() => abortRef.current?.abort(), []);

  const clearLocalIndex = useCallback(async () => {
    await localClear();
    await kvSet(LOCAL_META_KEY, null);
    clearLocalThumbUrls();
    localRef.current = [];
    setLocalPhotos([]);
    setLocalScanAt(null);
    app.toast('Индекс устройства очищен', 'success');
  }, [app]);

  // --- Переименование по содержимому ---
  // Выделение ссылается на пути — после переименования перекладываем на новые.
  const remapSelection = useCallback(
    (remap: Map<string, string>) => {
      if (!remap.size || !app.selected.size) return;
      const next = [...app.selected.entries()].map(([p, f]) => {
        const np = remap.get(p);
        return np ? { path: np, name: baseName(np), preview: f.preview } : { path: p, name: f.name, preview: f.preview };
      });
      app.replaceSelection(next);
    },
    [app],
  );

  const renameLocal = useCallback(
    async (pairs: Map<string, string>) => {
      const done: { from: string; to: string }[] = [];
      const failed: { from: string; error: string }[] = [];
      for (const [from, to] of pairs) {
        if (from === to) continue;
        try {
          let target = to;
          if (await exists(target)) {
            // Не затираем чужой файл — подбираем свободное имя.
            const dir = parentLocal(to);
            const name = baseName(to);
            const dot = name.lastIndexOf('.');
            const stem = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            let alt: string | null = null;
            for (let i = 1; i <= 30; i++) {
              const cand = joinLocal(dir, `${stem} (${i})${ext}`);
              if (!(await exists(cand))) {
                alt = cand;
                break;
              }
            }
            if (!alt) throw new Error('Не удалось подобрать свободное имя');
            target = alt;
          }
          await renameFile(from, target);
          const rec = localRef.current.find((r) => r.path === from);
          dropLocalThumbUrl(from);
          if (rec) {
            const next: PhotoRec = {
              ...rec,
              path: target,
              name: baseName(target),
              dir: parentLocal(target),
            };
            await localDel([from]);
            await localSet(next);
          }
          done.push({ from, to: target });
        } catch (e) {
          failed.push({ from, error: (e as Error)?.message || 'Ошибка переименования' });
        }
      }
      if (done.length) {
        const journal = [...renameJournal, ...done.map((d) => ({ ...d, at: Date.now() }))].slice(-MAX_JOURNAL);
        setRenameJournal(journal);
        await kvSet(JOURNAL_KEY, journal);
        await reloadLocal();
        remapSelection(new Map(done.map((d) => [d.from, d.to])));
      }
      return { done: done.length, failed };
    },
    [renameJournal, reloadLocal, remapSelection],
  );

  const undoRenames = useCallback(async () => {
    let done = 0;
    let failed = 0;
    const remaining = [...renameJournal];
    const undone = new Map<string, string>();
    // Откат с конца: последнее переименование возвращается первым.
    for (let i = renameJournal.length - 1; i >= 0; i--) {
      const entry = renameJournal[i];
      try {
        if (!(await exists(entry.to))) throw new Error('файл уже перемещён или удалён');
        if (await exists(entry.from)) throw new Error('старое имя уже занято');
        await renameFile(entry.to, entry.from);
        const rec = localRef.current.find((r) => r.path === entry.to);
        dropLocalThumbUrl(entry.to);
        if (rec) {
          const next: PhotoRec = { ...rec, path: entry.from, name: baseName(entry.from), dir: parentLocal(entry.from) };
          await localDel([entry.to]);
          await localSet(next);
        }
        remaining.pop();
        undone.set(entry.to, entry.from);
        done++;
      } catch {
        failed++;
        break; // дальше откатывать бессмысленно — цепочка нарушена
      }
    }
    setRenameJournal(remaining);
    await kvSet(JOURNAL_KEY, remaining);
    if (done) {
      await reloadLocal();
      remapSelection(undone);
    }
    return { done, failed };
  }, [renameJournal, reloadLocal, remapSelection]);

  // --- Трансфер ---
  const downloadTo = useCallback(
    (reqs: DownloadRequest[], targetDir: string, deleteAfter: boolean) =>
      enqueueDownloads(reqs, targetDir, deleteAfter),
    [],
  );

  const uploadTo = useCallback(
    (reqs: UploadRequest[], diskDir: string, deleteLocal: boolean) => {
      const policy = (app.settings.conflictPolicy ?? 'rename') as ConflictPolicy;
      return enqueueUploads(reqs, diskDir, policy, deleteLocal);
    },
    [app.settings.conflictPolicy],
  );

  const togglePause = useCallback(() => {
    setTransferPausedState((prev) => {
      const next = !prev;
      setTransferPaused(next);
      return next;
    });
  }, []);

  const value: DeviceCtx = {
    supported,
    access,
    refreshAccess,
    grantAccess,
    localPhotos,
    localScanAt,
    localScanning,
    localProgress,
    localProgressLog,
    scanLocal,
    cancelLocalScan,
    reloadLocal,
    clearLocalIndex,
    renameLocal,
    renameJournal,
    undoRenames,
    captionStatus,
    setCaptionStatus,
    jobs,
    transferPaused,
    downloadTo,
    uploadTo,
    togglePause,
    cancelTransfer: cancelJob,
    retryTransfer: retryJob,
    clearFinished: clearFinishedJobs,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function abortErrorLocal(): DOMException {
  return new DOMException('Операция отменена', 'AbortError');
}
