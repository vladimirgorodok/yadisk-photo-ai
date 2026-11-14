import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { listDir, parentLocal, type DeviceFile } from '../lib/localfs';
import { formatDate } from '../lib/util';

export const QUICK_DIRS = [
  { label: 'Память устройства', path: '/storage/emulated/0' },
  { label: 'DCIM', path: '/storage/emulated/0/DCIM' },
  { label: 'Pictures', path: '/storage/emulated/0/Pictures' },
  { label: 'Download', path: '/storage/emulated/0/Download' },
  { label: 'Movies', path: '/storage/emulated/0/Movies' },
];

export interface DirState {
  path: string;
  listing: { dirs: DeviceFile[]; files: DeviceFile[] } | null;
  loading: boolean;
  error: string | null;
}

/** Состояние браузера папок устройства (используется в «Менеджере» и «Переименовании»). */
export function useLocalDir(initial = '/storage/emulated/0'): DirState & { load: (p: string) => Promise<void>; open: (p: string) => void } {
  const [state, setState] = useState<DirState>({ path: initial, listing: null, loading: false, error: null });
  const loadedRef = useRef(false);

  const load = useCallback(async (p: string) => {
    const path = p.trim() || '/';
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const listing = await listDir(path);
      setState({ path, listing, loading: false, error: null });
      loadedRef.current = true;
    } catch (e) {
      setState((s) => ({ path, listing: null, loading: false, error: (e as Error)?.message || 'Не удалось прочитать папку' }));
    }
  }, []);

  const open = useCallback(
    (p: string) => {
      void load(p);
    },
    [load],
  );

  return { ...state, load, open };
}

function fmtSize(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

/**
 * Браузер папок устройства: строка пути, быстрые папки, список подпапок
 * и файлов (с опциональным выделением). Общается с экранами
 * «Менеджер» и «Переименование».
 */
export function DirBrowser({
  dir,
  quick = QUICK_DIRS,
  children,
  selectable = false,
  selected,
  onToggle,
}: {
  dir: DirState & { load: (p: string) => Promise<void> };
  quick?: { label: string; path: string }[];
  children?: ReactNode;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (f: DeviceFile) => void;
}) {
  const [input, setInput] = useState(dir.path);
  const { listing } = dir;
  const selCount = selected?.size ?? 0;

  // Синхронизируем строку пути, когда папку сменили кнопками/чипами.
  useEffect(() => {
    setInput(dir.path);
  }, [dir.path]);

  return (
    <section className="search-box">
      <div className="search-row">
        <input
          className="path-box"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void dir.load(input);
          }}
          spellCheck={false}
          placeholder="/storage/emulated/0/…"
        />
        <button className="btn ghost" onClick={() => void dir.load(input)} disabled={dir.loading}>
          {dir.loading ? '…' : 'Открыть'}
        </button>
        <button
          className="btn ghost"
          title="Наверх"
          onClick={() => void dir.load(parentLocal(dir.path))}
          disabled={dir.path === '/'}
        >
          ↑
        </button>
      </div>
      <div className="chips">
        {quick.map((q) => (
          <button key={q.path} className={`chip ${dir.path === q.path ? 'on' : ''}`} onClick={() => void dir.load(q.path)}>
            {q.label}
          </button>
        ))}
      </div>

      {dir.error && (
        <div className="index-line">
          <span className="err-text">⚠ {dir.error}</span>
        </div>
      )}

      {listing && listing.dirs.length > 0 && (
        <div className="path-chips">
          {listing.dirs.slice(0, 80).map((d) => (
            <button key={d.path} className="chip" title={d.path} onClick={() => void dir.load(d.path)}>
              📁 {d.name}
            </button>
          ))}
          {listing.dirs.length > 80 && <span className="muted">…ещё {listing.dirs.length - 80}</span>}
        </div>
      )}

      {listing && (
        <div className="index-line">
          <span className="muted">
            Файлов: <b>{listing.files.length}</b> · папок: <b>{listing.dirs.length}</b>
            {selectable && selCount > 0 && (
              <>
                {' '}
                · выделено: <b>{selCount}</b>
              </>
            )}
          </span>
          <span className="index-actions">{children}</span>
        </div>
      )}

      {selectable && listing && listing.files.length > 0 && (
        <ul className="file-list">
          {listing.files.slice(0, 300).map((f) => {
            const on = selected?.has(f.path) ?? false;
            return (
              <li key={f.path}>
                <label className="file-row" title={f.path}>
                  <input type="checkbox" checked={on} onChange={() => onToggle?.(f)} />
                  <span className="file-name">
                    🖼 {f.name}
                  </span>
                  <span className="muted file-meta">
                    {fmtSize(f.size)}
                    {f.mtime ? ` · ${formatDate(new Date(f.mtime).toISOString())}` : ''}
                  </span>
                </label>
              </li>
            );
          })}
          {listing.files.length > 300 && <li className="muted">… показаны первые 300 файлов</li>}
        </ul>
      )}
    </section>
  );
}
