import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { joinPath, type YItem } from '../lib/api';
import { formatBytes } from '../lib/util';
import { Modal } from './Modal';
import { fileIcon } from './PhotoGrid';

interface TreeNodeState {
  items: YItem[] | null;
  loading: boolean;
  error?: string;
}

function Row({
  item,
  depth,
  expanded,
  toggle,
  target,
  select,
  tree,
  load,
}: {
  item: YItem;
  depth: number;
  expanded: Set<string>;
  toggle: (p: string) => void;
  target: string;
  select: (p: string) => void;
  tree: Map<string, TreeNodeState>;
  load: (p: string) => void;
}) {
  const isDir = item.type === 'dir';
  const isOpen = expanded.has(item.path);
  useEffect(() => {
    if (isDir && isOpen && !tree.has(item.path)) load(item.path);
  }, [isDir, isOpen, item.path, tree, load]);
  const state = tree.get(item.path);
  return (
    <div>
      <div
        className={`tree-row ${isDir ? 'dir' : 'file'} ${target === item.path ? 'active' : ''}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => isDir && select(item.path)}
        title={item.path}
      >
        {isDir ? (
          <button
            className="caret"
            aria-label={isOpen ? 'Свернуть' : 'Развернуть'}
            onClick={(e) => {
              e.stopPropagation();
              toggle(item.path);
            }}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="caret-spacer" />
        )}
        <span className="tree-ico">{isDir ? (isOpen ? '📂' : '📁') : fileIcon(item.name)}</span>
        <span className="tree-name">{item.name}</span>
        {!isDir && <span className="tree-size">{formatBytes(item.size)}</span>}
      </div>
      {isDir && isOpen && (
        <div>
          {state?.loading && <div className="tree-hint" style={{ paddingLeft: 30 + depth * 16 }}>Загрузка…</div>}
          {state?.error && (
            <div className="tree-hint err" style={{ paddingLeft: 30 + depth * 16 }}>
              {state.error}
            </div>
          )}
          {state?.items?.length === 0 && !state.loading && (
            <div className="tree-hint" style={{ paddingLeft: 30 + depth * 16 }}>
              Пусто
            </div>
          )}
          {state?.items?.map((it) => (
            <Row
              key={it.path}
              item={it}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              target={target}
              select={select}
              tree={tree}
              load={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Drawer() {
  const app = useApp();
  const { api, selected, drawerOpen, setDrawerOpen, moving, toast, treeVersion, updateSettings, settings } = app;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['disk:/']));
  const [children, setChildren] = useState<Map<string, TreeNodeState>>(new Map());
  const [target, setTarget] = useState<string>(() => settings.lastFolder || 'disk:/');
  const [createOpen, setCreateOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const loadingRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (path: string) => {
      if (!api || loadingRef.current.has(path)) return;
      loadingRef.current.add(path);
      setChildren((prev) => new Map(prev).set(path, { items: prev.get(path)?.items ?? null, loading: true }));
      try {
        const all: YItem[] = [];
        let offset = 0;
        for (;;) {
          const page = await api.list(path, { offset, limit: 100, preview: false });
          all.push(...page.items);
          offset += page.items.length;
          if (!page.items.length || offset >= page.total) break;
        }
        all.sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name, 'ru') : a.type === 'dir' ? -1 : 1,
        );
        setChildren((prev) => new Map(prev).set(path, { items: all, loading: false }));
      } catch (e) {
        setChildren((prev) =>
          new Map(prev).set(path, { items: null, loading: false, error: (e as Error).message }),
        );
      } finally {
        loadingRef.current.delete(path);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!drawerOpen || !api) return;
    setChildren(new Map());
    loadingRef.current.clear();
    load('disk:/');
  }, [drawerOpen, api, treeVersion, load]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const select = (path: string) => {
    setTarget(path);
    setExpanded((prev) => new Set(prev).add(path));
    updateSettings({ lastFolder: path });
  };

  const doCreate = async () => {
    const name = folderName.trim();
    if (!api || !name) return;
    if (/[\\/]/.test(name)) {
      toast('Имя папки не должно содержать «/»', 'error');
      return;
    }
    setCreating(true);
    const full = joinPath(target, name);
    try {
      await api.createFolder(full);
      toast(`Папка создана: ${full}`, 'success');
      setCreateOpen(false);
      setFolderName('');
      setTarget(full);
      setExpanded((prev) => new Set(prev).add(target));
      setChildren((prev) => {
        const next = new Map(prev);
        next.delete(target);
        return next;
      });
      load(target);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const doMove = async () => {
    setMoveBusy(true);
    try {
      await app.moveMany([...selected.values()], target, overwrite);
      setConfirmMove(false);
      setChildren((prev) => {
        const next = new Map(prev);
        next.delete(target);
        return next;
      });
      load(target);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setMoveBusy(false);
    }
  };

  if (!api) return null;

  const rootItem: YItem = { name: 'Яндекс Диск', path: 'disk:/', type: 'dir' };

  return (
    <>
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-head" onClick={() => setDrawerOpen(!drawerOpen)}>
          <div className="drawer-title">
            <span className="drawer-ico">🗂️</span>
            <span>Файлы Яндекс Диска</span>
            {selected.size > 0 && <span className="badge">{selected.size}</span>}
          </div>
          <div className="drawer-tools" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn ghost sm"
              title="Создать папку"
              onClick={() => {
                setFolderName('');
                setCreateOpen(true);
                setDrawerOpen(true);
              }}
            >
              + Папка
            </button>
            <button
              className="icon-btn"
              title="Обновить дерево"
              onClick={() => {
                setChildren(new Map());
                loadingRef.current.clear();
                load('disk:/');
              }}
            >
              ⟳
            </button>
            <button
              className="icon-btn"
              title={drawerOpen ? 'Свернуть' : 'Развернуть'}
              onClick={() => setDrawerOpen(!drawerOpen)}
            >
              {drawerOpen ? '▾' : '▴'}
            </button>
          </div>
        </div>

        {drawerOpen && (
          <div className="drawer-body">
            <div className="tree">
              <Row
                item={rootItem}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                target={target}
                select={select}
                tree={children}
                load={load}
              />
            </div>
            <div className="move-bar">
              <div className="move-info">
                <div className="move-label">Папка назначения</div>
                <div className="move-path" title={target}>
                  {target}
                </div>
                <div className="move-count">
                  {selected.size
                    ? `Выбрано файлов: ${selected.size}`
                    : 'Отметьте фотографии в результатах поиска или в группах'}
                </div>
              </div>
              <button
                className="btn primary"
                disabled={!selected.size || moving !== null || moveBusy}
                onClick={() => {
                  setOverwrite(false);
                  setConfirmMove(true);
                }}
              >
                {moving ? `Перемещение ${moving.done}/${moving.total}` : `Переместить${selected.size ? ` (${selected.size})` : ''}`}
              </button>
            </div>
            {moving && (
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{ width: `${moving.total ? Math.round((moving.done / moving.total) * 100) : 0}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {createOpen && (
        <Modal
          title="Новая папка"
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                Отмена
              </button>
              <button className="btn primary" onClick={doCreate} disabled={creating || !folderName.trim()}>
                {creating ? 'Создаю…' : 'Создать'}
              </button>
            </>
          }
        >
          <p className="muted">
            Будет создана в папке <b>{target}</b>
          </p>
          <label className="field">
            <span>Имя папки</span>
            <input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Например, Отпуск 2026"
              onKeyDown={(e) => {
                if (e.key === 'Enter') doCreate();
              }}
            />
          </label>
        </Modal>
      )}

      {confirmMove && (
        <Modal
          title="Переместить файлы"
          onClose={() => setConfirmMove(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmMove(false)} disabled={moveBusy}>
                Отмена
              </button>
              <button className="btn primary" onClick={doMove} disabled={moveBusy}>
                {moveBusy ? 'Перемещаю…' : `Переместить (${selected.size})`}
              </button>
            </>
          }
        >
          <p>
            Переместить <b>{selected.size}</b> файлов в папку:
          </p>
          <div className="path-box">{target}</div>
          <label className="checkline">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>Заменять существующие файлы с такими же именами</span>
          </label>
          <p className="muted small">
            Без замены конфликтующие имена получат суффикс «(1)». Папка будет создана, если её нет.
          </p>
        </Modal>
      )}
    </>
  );
}
