import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DiskInfo } from '../lib/api';
import { YandexDisk, moveFiles, DiskError, type MoveResult } from '../lib/api';
import { loadSettings, saveSettings, consumeOAuthToken, type Settings } from '../lib/settings';
import { photoDel, photoEntries, kvGet, kvSet } from '../lib/db';
import { ensureEmbeddings, recMap, scanDisk } from '../lib/scan';
import { modelsLoaded, preloadAll, setModelStatus } from '../lib/ai';
import { isAbort, uid } from '../lib/util';
import type { IndexMeta, PhotoRec, Progress, SelectedFile } from '../types';

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface ModelsState {
  loaded: boolean;
  loading: boolean;
  pct: number;
  msg: string;
}

interface AppCtx {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  api: YandexDisk | null;
  connected: boolean;
  checking: boolean;
  connectError: string | null;
  user: string | null;
  disk: DiskInfo | null;
  refreshDisk: () => Promise<void>;
  photos: PhotoRec[];
  photosVersion: number;
  scanAt: number | null;
  scanning: boolean;
  progress: Progress | null;
  progressLog: string[];
  scan: () => Promise<void>;
  cancelScan: () => void;
  reloadPhotos: () => Promise<void>;
  models: ModelsState;
  preload: () => Promise<void>;
  selected: Map<string, SelectedFile>;
  isSelected: (path: string) => boolean;
  toggleSelect: (file: SelectedFile) => void;
  addSelection: (files: SelectedFile[]) => void;
  replaceSelection: (files: SelectedFile[]) => void;
  clearSelection: () => void;
  moveMany: (files: SelectedFile[], targetDir: string, overwrite: boolean) => Promise<MoveResult>;
  moving: { done: number; total: number } | null;
  treeVersion: number;
  bumpTree: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp вне провайдера');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [photos, setPhotos] = useState<PhotoRec[]>([]);
  const photosRef = useRef<PhotoRec[]>([]);
  const [photosVersion, setPhotosVersion] = useState(0);
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
  const [models, setModels] = useState<ModelsState>({
    loaded: modelsLoaded(),
    loading: false,
    pct: 0,
    msg: '',
  });
  const [selected, setSelected] = useState<Map<string, SelectedFile>>(new Map());
  const [treeVersion, setTreeVersion] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scanningRef = useRef(false);
  const lastLogRef = useRef('');

  const api = useMemo(() => (settings.token ? new YandexDisk(settings.token) : null), [settings.token]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = uid();
    setToasts((prev) => [...prev.slice(-4), { id, text, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'error' ? 9000 : 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // OAuth-токен из hash после редиректа
  useEffect(() => {
    const res = consumeOAuthToken();
    if (!res) return;
    if (res.token) {
      updateSettings({ token: res.token });
      toast('Яндекс Диск подключён', 'success');
    } else if (res.error) {
      toast(res.error, 'error');
    }
  }, [toast, updateSettings]);

  // Загрузка локального индекса
  useEffect(() => {
    (async () => {
      try {
        const entries = await photoEntries();
        const list = entries.map(([, rec]) => rec);
        photosRef.current = list;
        setPhotos(list);
        const meta = await kvGet<IndexMeta>('indexMeta');
        setScanAt(meta?.scanAt ?? null);
      } catch (e) {
        console.warn('Не удалось прочитать локальный индекс', e);
      }
    })();
  }, []);

  // Проверка подключения при смене токена
  useEffect(() => {
    if (!api) {
      setConnected(false);
      setChecking(false);
      setUser(null);
      setDisk(null);
      setConnectError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setChecking(true);
      setConnectError(null);
      try {
        const info = await api.info();
        if (cancelled) return;
        setDisk(info);
        setConnected(true);
        setUser(info.login || (await api.loginInfo()));
      } catch (e) {
        if (cancelled) return;
        // Токен может быть без права «информация о Диске» — проверяем доступ к файлам.
        if (e instanceof DiskError && e.status === 403) {
          try {
            await api.list('disk:/', { limit: 1, preview: false });
            if (cancelled) return;
            setDisk(null);
            setConnected(true);
            setUser(await api.loginInfo());
            return;
          } catch {
            /* ниже покажем исходную ошибку */
          }
        }
        if (cancelled) return;
        setConnected(false);
        setConnectError((e as Error)?.message || 'Не удалось подключиться к Яндекс Диску');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const refreshDisk = useCallback(async () => {
    if (!api) return;
    try {
      setDisk(await api.info());
    } catch {
      /* ignore */
    }
  }, [api]);

  const pushProgress = useCallback((p: Progress) => {
    setProgress(p);
    const line = p.detail ? `${p.label} — ${p.detail}` : p.label;
    if (line !== lastLogRef.current && !(p.detail && p.label === lastLogRef.current.split(' — ')[0] && p.detail.length > 40)) {
      lastLogRef.current = line;
      setProgressLog((prev) => [...prev.slice(-7), line]);
    }
  }, []);

  const reloadPhotos = useCallback(async () => {
    const entries = await photoEntries();
    const list = entries.map(([, rec]) => rec);
    photosRef.current = list;
    setPhotos(list);
    setPhotosVersion((v) => v + 1);
  }, []);

  const preload = useCallback(async () => {
    setModels((m) => ({ ...m, loading: true, msg: 'Загрузка ИИ-моделей…' }));
    setModelStatus((s) => setModels((m) => ({ ...m, pct: s.pct, msg: s.msg })));
    try {
      await preloadAll();
      setModels({ loaded: true, loading: false, pct: 100, msg: 'ИИ-модели готовы' });
    } catch (e) {
      const msg = (e as Error)?.message || 'Ошибка загрузки моделей';
      setModels((m) => ({ ...m, loading: false, msg }));
      setModelStatus(null);
      throw e;
    }
    setModelStatus(null);
  }, []);

  const scan = useCallback(async () => {
    if (!api) {
      toast('Сначала подключите Яндекс Диск в настройках', 'error');
      return;
    }
    if (scanningRef.current) return;
    scanningRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setScanning(true);
    setProgressLog([]);
    lastLogRef.current = '';
    pushProgress({ label: 'Сканирую Диск', done: 0, total: 1 });
    try {
      const old = recMap(photosRef.current);
      const result = await scanDisk(api, old, pushProgress, ctrl.signal);
      photosRef.current = result;
      setPhotos(result);
      setPhotosVersion((v) => v + 1);
      if (result.length) {
        pushProgress({ label: 'Загружаю ИИ-модели', done: 0, total: 1 });
        await preload();
        await ensureEmbeddings(api, result, settings.modelKey, pushProgress, ctrl.signal);
        photosRef.current = [...result];
        setPhotos([...result]);
        setPhotosVersion((v) => v + 1);
      }
      const meta: IndexMeta = {
        scanAt: Date.now(),
        count: result.length,
        modelKey: settings.modelKey,
      };
      await kvSet('indexMeta', meta);
      setScanAt(meta.scanAt);
      const withEmb = result.filter((p) => p.emb).length;
      toast(
        result.length
          ? `Готово: найдено ${result.length} фото, проанализировано ${withEmb}`
          : 'На Диске не найдено фотографий',
        'success',
      );
    } catch (e) {
      if (!isAbort(e)) toast((e as Error)?.message || 'Ошибка сканирования', 'error');
    } finally {
      scanningRef.current = false;
      abortRef.current = null;
      setScanning(false);
      setProgress(null);
    }
  }, [api, preload, pushProgress, settings.modelKey, toast]);

  const cancelScan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const isSelected = useCallback((path: string) => selected.has(path), [selected]);

  const toggleSelect = useCallback((file: SelectedFile) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(file.path)) next.delete(file.path);
      else next.set(file.path, file);
      return next;
    });
  }, []);

  const addSelection = useCallback((files: SelectedFile[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const f of files) next.set(f.path, f);
      return next;
    });
  }, []);

  const replaceSelection = useCallback((files: SelectedFile[]) => {
    setSelected(new Map(files.map((f) => [f.path, f])));
  }, []);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

  const bumpTree = useCallback(() => setTreeVersion((v) => v + 1), []);

  const moveMany = useCallback(
    async (files: SelectedFile[], targetDir: string, overwrite: boolean): Promise<MoveResult> => {
      if (!api) throw new Error('Яндекс Диск не подключён');
      const res: MoveResult = { moved: [], failed: [] };
      // Перемещение действует только для файлов Диска (локальные файлы — в «Устройстве»).
      files = files.filter((f) => f.path.startsWith('disk:'));
      if (!files.length) return res;
      setMoving({ done: 0, total: files.length });
      try {
        await api.ensureFolder(targetDir);
        const r = await moveFiles(api, files, targetDir, overwrite, (done, total) => setMoving({ done, total }));
        res.moved = r.moved;
        res.failed = r.failed;
        if (r.moved.length) {
          const movedFrom = new Set(r.moved.map((m) => m.from));
          const remaining = photosRef.current.filter((p) => !movedFrom.has(p.path));
          photosRef.current = remaining;
          setPhotos(remaining);
          setPhotosVersion((v) => v + 1);
          await photoDel([...movedFrom]);
          setSelected((prev) => {
            const next = new Map(prev);
            for (const m of r.moved) next.delete(m.from);
            return next;
          });
          bumpTree();
        }
        if (r.moved.length && r.failed.length) {
          toast(`Перемещено: ${r.moved.length}, ошибок: ${r.failed.length}`, 'info');
        } else if (r.moved.length) {
          toast(`Перемещено файлов: ${r.moved.length}`, 'success');
        } else if (r.failed.length) {
          toast(`Не удалось переместить. ${r.failed[0].error}`, 'error');
        }
        return res;
      } finally {
        setMoving(null);
      }
    },
    [api, bumpTree, toast],
  );

  const value: AppCtx = {
    settings,
    updateSettings,
    api,
    connected,
    checking,
    connectError,
    user,
    disk,
    refreshDisk,
    photos,
    photosVersion,
    scanAt,
    scanning,
    progress,
    progressLog,
    scan,
    cancelScan,
    reloadPhotos,
    models,
    preload,
    selected,
    isSelected,
    toggleSelect,
    addSelection,
    replaceSelection,
    clearSelection,
    moveMany,
    moving,
    treeVersion,
    bumpTree,
    drawerOpen,
    setDrawerOpen,
    toasts,
    toast,
    dismissToast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
