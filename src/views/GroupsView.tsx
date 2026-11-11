import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { clusterFaces, computeThemes, runFacePass, type FaceGroupView } from '../lib/group';
import { photoEntries } from '../lib/db';
import { isAbort, plural } from '../lib/util';
import { previewCache } from '../lib/scan';
import { nameOf } from '../lib/api';
import { ProgressPanel } from '../components/ProgressPanel';
import { Modal } from '../components/Modal';
import { MoveDialog } from '../components/MoveDialog';
import type { Progress, SelectedFile, ThemeGroup } from '../types';

function safeFolderName(label: string): string {
  return label.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Группа';
}

function uniquePaths<T extends { path: string }>(items: T[]): string[] {
  return [...new Set(items.map((i) => i.path))];
}

export function GroupsView() {
  const app = useApp();
  const [faceGroups, setFaceGroups] = useState<FaceGroupView[]>([]);
  const [themes, setThemes] = useState<ThemeGroup[]>([]);
  const [stats, setStats] = useState<{ photos: number; faces: number } | null>(null);
  const [tab, setTab] = useState<'faces' | 'themes'>('faces');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [filesModal, setFilesModal] = useState<{ title: string; items: SelectedFile[] } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [moveGroup, setMoveGroup] = useState<{ title: string; files: SelectedFile[]; path: string } | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  const photoMap = useMemo(() => new Map(app.photos.map((p) => [p.path, p])), [app.photos]);

  const makeFiles = (paths: string[]): SelectedFile[] =>
    [...new Set(paths)].map((path) => {
      const rec = photoMap.get(path);
      return {
        path,
        name: rec?.name ?? nameOf(path),
        preview: previewCache.get(path) ?? rec?.preview,
      };
    });

  const run = async () => {
    if (!app.api) {
      app.toast('Сначала подключите Яндекс Диск', 'error');
      return;
    }
    if (running) return;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRunning(true);
    setProgress({ label: 'Подготовка агента', done: 0, total: 1 });
    try {
      let list = app.photos;
      if (!list.length) {
        await app.scan();
        list = (await photoEntries()).map(([, rec]) => rec);
      }
      if (!list.length) {
        app.toast('На Диске не найдено фотографий', 'error');
        return;
      }
      if (!list.some((p) => p.emb)) {
        app.toast('Сначала постройте индекс на вкладке «Поиск» (Сканировать Диск)', 'error');
        return;
      }
      setProgress({ label: 'Загружаю ИИ-модели', done: 0, total: 1 });
      await app.preload();
      const faceRes = await runFacePass(app.api, list, setProgress, ctrl.signal);
      setProgress({ label: 'Кластеризация лиц', done: 0, total: 1 });
      const fg = clusterFaces(list);
      setFaceGroups(fg);
      const tg = await computeThemes(list, setProgress, ctrl.signal);
      setThemes(tg);
      setStats({ photos: list.length, faces: faceRes.faces });
      await app.reloadPhotos();
      app.toast(
        `Готово: лиц ${faceRes.faces}, групп людей ${fg.length}, тем ${tg.length}`,
        'success',
      );
    } catch (e) {
      if (!isAbort(e)) app.toast((e as Error)?.message || 'Ошибка группировки', 'error');
    } finally {
      ctrlRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const openFiles = (title: string, paths: string[]) => {
    const items = makeFiles(paths);
    setChecked(new Set(items.map((i) => i.path)));
    setFilesModal({ title, items });
  };

  const applyMoved = (movedPaths: string[]) => {
    const moved = new Set(movedPaths);
    setFaceGroups((groups) =>
      groups
        .map((g) => ({ ...g, members: g.members.filter((m) => !moved.has(m.path)) }))
        .filter((g) => g.members.length > 0),
    );
    setThemes((groups) =>
      groups
        .map((g) => {
          const paths = g.paths.filter((p) => !moved.has(p));
          return { ...g, paths, count: paths.length };
        })
        .filter((g) => g.count > 0),
    );
  };

  const moveNow = (title: string, paths: string[], folder: string) => {
    setMoveGroup({ title, files: makeFiles(paths), path: `disk:/AI-Группы/${safeFolderName(folder)}` });
  };

  return (
    <div className="view">
      <div className="hero-card compact">
        <div className="hero-row">
          <div>
            <h2>Агент группировки</h2>
            <p className="muted">
              Находит лица и объединяет фотографии одного человека, а также раскладывает снимки по сюжетам: животные,
              природа, еда, документы и другое. Всё считается локально на устройстве.
            </p>
          </div>
          <div className="hero-actions">
            <button className="btn primary" onClick={run} disabled={running || app.scanning}>
              {running ? 'Анализирую…' : stats ? 'Обновить анализ' : 'Запустить агента'}
            </button>
          </div>
        </div>
        {stats && (
          <div className="muted small">
            Проанализировано фото: {stats.photos} · найдено лиц: {stats.faces} · групп людей: {faceGroups.length} ·
            тем: {themes.length}
          </div>
        )}
      </div>

      {running && progress && (
        <ProgressPanel progress={progress} onCancel={() => ctrlRef.current?.abort()} />
      )}
      {app.scanning && app.progress && (
        <ProgressPanel progress={app.progress} log={app.progressLog} onCancel={app.cancelScan} />
      )}
      {!running && app.models.loading && (
        <ProgressPanel progress={{ label: app.models.msg || 'Загрузка ИИ-моделей', done: app.models.pct, total: 100 }} />
      )}

      {(faceGroups.length > 0 || themes.length > 0) && (
        <>
          <div className="segmented">
            <button className={tab === 'faces' ? 'on' : ''} onClick={() => setTab('faces')}>
              Лица · {faceGroups.length}
            </button>
            <button className={tab === 'themes' ? 'on' : ''} onClick={() => setTab('themes')}>
              Сюжеты · {themes.length}
            </button>
          </div>

          {tab === 'faces' && (
            <div className="group-list">
              {faceGroups.length === 0 && (
                <div className="empty">
                  <p>
                    Группы людей не найдены: лиц должно быть минимум два на одного человека. Попробуйте больше
                    фотографий.
                  </p>
                </div>
              )}
              {faceGroups.map((g) => {
                const paths = uniquePaths(g.members);
                return (
                  <div className="group-card" key={g.id}>
                    <div className="group-head">
                      <div>
                        <div className="group-title">{g.label}</div>
                        <div className="muted small">
                          {paths.length} {plural(paths.length, 'фото', 'фото', 'фото')}
                        </div>
                      </div>
                      <div className="group-actions">
                        <button className="btn ghost sm" onClick={() => openFiles(g.label, paths)}>
                          Файлы
                        </button>
                        <button className="btn sm" onClick={() => moveNow(g.label, paths, g.label)}>
                          Переместить
                        </button>
                      </div>
                    </div>
                    <div className="face-strip">
                      {g.members.slice(0, 12).map((m, i) =>
                        m.thumb ? (
                          <img key={i} src={m.thumb} alt="" className="face-thumb" loading="lazy" />
                        ) : (
                          <div key={i} className="face-thumb placeholder">
                            👤
                          </div>
                        ),
                      )}
                      {g.members.length > 12 && <div className="face-thumb more">+{g.members.length - 12}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'themes' && (
            <div className="group-list">
              {themes.length === 0 && <div className="empty"><p>Сюжетные группы пока не найдены.</p></div>}
              {themes.map((g) => (
                <div className="group-card" key={g.id}>
                  <div className="group-head">
                    <div>
                      <div className="group-title">{g.label}</div>
                      <div className="muted small">
                        {g.count} {plural(g.count, 'фото', 'фото', 'фото')}
                      </div>
                    </div>
                    <div className="group-actions">
                      <button className="btn ghost sm" onClick={() => openFiles(g.label, g.paths)}>
                        Файлы
                      </button>
                      <button className="btn sm" onClick={() => moveNow(g.label, g.paths, g.label)}>
                        Переместить
                      </button>
                    </div>
                  </div>
                  <div className="theme-covers">
                    {g.covers.length ? (
                      g.covers.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)
                    ) : (
                      <div className="theme-cover-empty">🖼️</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!running && !faceGroups.length && !themes.length && (
        <div className="empty">
          <p>
            Запустите агента, чтобы сгруппировать фотографии по людям и сюжетам. Понадобится локальный индекс (кнопка
            «Сканировать Диск» на вкладке «Поиск»).
          </p>
        </div>
      )}

      {filesModal && (
        <Modal
          wide
          title={filesModal.title}
          onClose={() => setFilesModal(null)}
          footer={
            <>
              <button
                className="btn ghost"
                onClick={() =>
                  setChecked(
                    checked.size === filesModal.items.length
                      ? new Set()
                      : new Set(filesModal.items.map((i) => i.path)),
                  )
                }
              >
                {checked.size === filesModal.items.length ? 'Снять все' : 'Выбрать все'}
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  const files = filesModal.items.filter((i) => checked.has(i.path));
                  if (!files.length) return;
                  setMoveGroup({ title: `Переместить: ${filesModal.title}`, files, path: app.settings.lastFolder || 'disk:/' });
                  setFilesModal(null);
                }}
                disabled={!checked.size}
              >
                Выбрать папку
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const files = filesModal.items.filter((i) => checked.has(i.path));
                  app.addSelection(files);
                  app.setDrawerOpen(true);
                  setFilesModal(null);
                  app.toast(`Добавлено к перемещению: ${files.length}. Выберите папку внизу.`, 'success');
                }}
                disabled={!checked.size}
              >
                К перемещению ({checked.size})
              </button>
            </>
          }
        >
          <div className="file-list">
            {filesModal.items.map((f) => {
              const on = checked.has(f.path);
              return (
                <label key={f.path} className={`file-row ${on ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.path)) next.delete(f.path);
                        else next.add(f.path);
                        return next;
                      })
                    }
                  />
                  {f.preview ? (
                    <img src={f.preview} alt="" loading="lazy" />
                  ) : (
                    <div className="file-thumb-empty">🖼️</div>
                  )}
                  <span className="file-name" title={f.path}>
                    {f.name}
                  </span>
                </label>
              );
            })}
          </div>
        </Modal>
      )}

      {moveGroup && (
        <MoveDialog
          title={moveGroup.title}
          files={moveGroup.files}
          defaultPath={moveGroup.path}
          onClose={() => setMoveGroup(null)}
          onDone={(moved) => {
            applyMoved(moved);
            setMoveGroup(null);
            if (filesModal) setFilesModal(null);
          }}
        />
      )}
    </div>
  );
}
