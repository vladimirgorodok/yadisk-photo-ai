import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import { PhotoGrid } from '../components/PhotoGrid';
import { ProgressPanel } from '../components/ProgressPanel';
import { RenameDialog } from '../components/RenameDialog';
import { UploadDialog } from '../components/UploadDialog';
import { TransferPanel } from '../components/TransferPanel';
import { scoreQuery } from '../lib/search';
import { listDir, parentLocal, type DeviceFile } from '../lib/localfs';
import { formatDate, plural } from '../lib/util';
import type { PhotoRec, SearchHit } from '../types';

const QUICK = [
  { label: 'Память устройства', path: '/storage/emulated/0' },
  { label: 'DCIM', path: '/storage/emulated/0/DCIM' },
  { label: 'Pictures', path: '/storage/emulated/0/Pictures' },
  { label: 'Download', path: '/storage/emulated/0/Download' },
  { label: 'Movies', path: '/storage/emulated/0/Movies' },
];

/**
 * «Устройство»: работа с локальными файлами по тем же принципам, что и с Диском —
 * сканирование папки, ИИ-анализ, поиск по описанию, переименование по содержимому,
 * выгрузка на Диск и очередь «Трансфер».
 */
export function DeviceView() {
  const app = useApp();
  const device = useDevice();
  const { settings, updateSettings, toast, selected, clearSelection } = app;

  // --- Доступ к файлам ---
  const [granting, setGranting] = useState(false);

  // --- Браузер папок ---
  const [path, setPath] = useState(settings.localRoot);
  const [listing, setListing] = useState<{ dirs: DeviceFile[]; files: DeviceFile[] } | null>(null);
  const [listingLoading, setListingLoading] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // --- Поиск ---
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searched, setSearched] = useState('');
  const [translated, setTranslated] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);

  // --- Диалоги ---
  const [renameOpen, setRenameOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const indexed = useMemo(() => device.localPhotos.filter((p) => p.emb && p.emb.length).length, [device.localPhotos]);
  const localSel = useMemo(
    () => device.localPhotos.filter((r) => selected.has(r.path)),
    [device.localPhotos, selected],
  );

  const filtered = useMemo(
    () => (hits ? hits.filter((h) => h.score >= settings.minScore) : null),
    [hits, settings.minScore],
  );
  const listRecs: PhotoRec[] = filtered ? filtered.map((h) => h.rec) : device.localPhotos;
  const scores = filtered ? new Map(filtered.map((h) => [h.rec.path, h.score])) : undefined;
  const visible = listRecs.slice(0, limit);

  const loadDir = async (p: string) => {
    setListingLoading(true);
    setListingError(null);
    try {
      const res = await listDir(p);
      setListing(res);
      setPath(p);
      updateSettings({ localRoot: p });
    } catch (e) {
      setListing(null);
      setListingError((e as Error)?.message || 'Не удалось прочитать папку');
    } finally {
      setListingLoading(false);
    }
  };

  // Первый вход: открываем последнюю папку (или память устройства).
  useEffect(() => {
    if (device.access !== 'granted' || loadedRef.current) return;
    loadedRef.current = true;
    void loadDir(settings.localRoot || '/storage/emulated/0');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.access]);

  const grant = async () => {
    setGranting(true);
    try {
      const ok = await device.grantAccess();
      if (ok) {
        toast('Доступ выдан — можно сканировать', 'success');
        loadedRef.current = false;
      } else {
        toast('Доступ не выдан: разрешите «Файлы и медиа» в настройках Android', 'error');
      }
    } finally {
      setGranting(false);
    }
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    if (!indexed) {
      toast('Сначала просканируйте папку устройства', 'error');
      return;
    }
    setSearching(true);
    setTranslated(null);
    try {
      await app.preload();
      const res = await scoreQuery(device.localPhotos, q);
      setHits(res.hits);
      setTranslated(res.translated);
      setSearched(q);
      setLimit(200);
    } catch (e) {
      toast((e as Error)?.message || 'Ошибка поиска', 'error');
    } finally {
      setSearching(false);
    }
  };

  const toggleAll = () => {
    if (filtered && filtered.length && filtered.every((h) => selected.has(h.rec.path))) {
      clearSelection();
    } else if (filtered) {
      app.replaceSelection(
        filtered.map((h) => ({
          path: h.rec.path,
          name: h.rec.name,
          preview: h.rec.thumb ? undefined : h.rec.preview,
        })),
      );
    }
  };

  // --- Гейт доступа / не-APK ---
  if (!device.supported) {
    return (
      <div className="view">
        <div className="hero-card">
          <div className="hero-emoji">📱</div>
          <h2>Файлы устройства — в APK</h2>
          <p className="muted">
            Работа с локальными файлами (сканирование, ИИ-анализ, переименование, трансфер) доступна
            в Android-приложении: браузер не даёт доступ к файловой системе. Скачайте APK в разделе
            «Релизы» на GitHub.
          </p>
        </div>
        <TransferPanel />
      </div>
    );
  }

  if (device.access !== 'granted') {
    return (
      <div className="view">
        <div className="hero-card">
          <div className="hero-emoji">🔐</div>
          <h2>Нужен доступ к файлам</h2>
          <p className="muted">
            Чтобы искать и переименовывать фотографии на устройстве, приложению нужен доступ «Файлы
            и медиа» (на новых Android — «Все файлы»). Доступ запрашивается один раз, файлы никуда
            не отправляются — весь ИИ-анализ работает офлайн.
          </p>
          <button className="btn primary" onClick={grant} disabled={granting}>
            {granting ? 'Запрашиваю…' : 'Выдать доступ'}
          </button>
        </div>
        <TransferPanel />
      </div>
    );
  }

  return (
    <div className="view">
      {/* --- Браузер папок --- */}
      <section className="search-box">
        <div className="search-row">
          <input
            className="path-box"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadDir(path.trim());
            }}
            spellCheck={false}
            placeholder="/storage/emulated/0/…"
          />
          <button className="btn ghost" onClick={() => void loadDir(path.trim())} disabled={listingLoading}>
            {listingLoading ? '…' : 'Открыть'}
          </button>
          <button
            className="btn ghost"
            title="Наверх"
            onClick={() => void loadDir(parentLocal(path.trim()))}
            disabled={path.trim() === '/'}
          >
            ↑
          </button>
        </div>
        <div className="chips">
          {QUICK.map((q) => (
            <button
              key={q.path}
              className={`chip ${path === q.path ? 'on' : ''}`}
              onClick={() => void loadDir(q.path)}
            >
              {q.label}
            </button>
          ))}
        </div>

        {listingError && (
          <div className="index-line">
            <span className="err-text">⚠ {listingError}</span>
          </div>
        )}

        {listing && listing.dirs.length > 0 && (
          <div className="path-chips">
            {listing.dirs.slice(0, 60).map((d) => (
              <button key={d.path} className="chip" title={d.path} onClick={() => void loadDir(d.path)}>
                📁 {d.name}
              </button>
            ))}
            {listing.dirs.length > 60 && <span className="muted">…ещё {listing.dirs.length - 60}</span>}
          </div>
        )}
        {listing && (
          <div className="index-line">
            <span className="muted">
              Файлов в папке: <b>{listing.files.length}</b> · папок: <b>{listing.dirs.length}</b>
            </span>
            <span className="index-actions">
              <button
                className="btn primary sm"
                onClick={() => void device.scanLocal(path.trim())}
                disabled={device.localScanning}
              >
                {device.localScanning
                  ? 'Сканирую…'
                  : device.localPhotos.length
                    ? 'Сканировать и анализировать'
                    : 'Сканировать папку'}
              </button>
            </span>
          </div>
        )}
      </section>

      {/* --- Индекс и поиск --- */}
      <section className="search-box">
        <div className="search-row">
          <input
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder="Поиск по содержимому: «кот на диване», «закат», «документы»…"
            enterKeyHint="search"
          />
          <button className="btn primary" onClick={() => void runSearch()} disabled={searching || device.localScanning}>
            {searching ? 'Ищу…' : 'Найти'}
          </button>
        </div>
        <div className="index-line">
          <span className="muted">
            В индексе устройства: <b>{device.localPhotos.length}</b>{' '}
            {plural(device.localPhotos.length, 'файл', 'файла', 'файлов')} · проанализировано ИИ: <b>{indexed}</b>
            {device.localScanAt ? ` · обновлён ${formatDate(new Date(device.localScanAt).toISOString())}` : ''}
          </span>
          <span className="index-actions">
            {device.renameJournal.length > 0 && (
              <button
                className="btn ghost sm"
                title={`Вернуть имена: ${device.renameJournal.length}`}
                onClick={async () => {
                  const res = await device.undoRenames();
                  if (res.done) toast(`Возвращено имён: ${res.done}`, 'success');
                  if (res.failed) toast(`Не удалось вернуть: ${res.failed}`, 'error');
                }}
              >
                ↶ Отменить переименования ({device.renameJournal.length})
              </button>
            )}
            {device.localPhotos.length > 0 && (
              <button
                className="btn ghost sm"
                onClick={async () => {
                  await device.clearLocalIndex();
                  clearSelection();
                }}
              >
                Очистить индекс
              </button>
            )}
          </span>
        </div>
      </section>

      {/* --- Прогресс --- */}
      {device.localScanning && device.localProgress && (
        <ProgressPanel
          progress={device.localProgress}
          log={device.localProgressLog}
          onCancel={device.cancelLocalScan}
        />
      )}
      {!device.localScanning && app.models.loading && (
        <ProgressPanel
          progress={{ label: app.models.msg || 'Загрузка ИИ-моделей', done: app.models.pct, total: 100 }}
        />
      )}

      {/* --- Пусто --- */}
      {!device.localPhotos.length && !device.localScanning && (
        <div className="hero-card">
          <div className="hero-emoji">📂</div>
          <h2>ИИ-анализ файлов устройства</h2>
          <p className="muted">
            Выберите папку выше и нажмите «Сканировать»: приложение составит список фотографий,
            создаст миниатюры и посчитает ИИ-признаки — после этого работает поиск по описанию,
            переименование по содержимому и выгрузка на Диск. Всё локально, без интернета.
          </p>
        </div>
      )}

      {/* --- Результаты --- */}
      {listRecs.length > 0 && (
        <>
          <div className="results-head">
            <div className="results-title">
              <h2>{hits ? `Результаты: «${searched}»` : 'Файлы устройства'}</h2>
              <span className="muted">
                {hits
                  ? `Найдено: ${filtered?.length ?? 0} · показано: ${Math.min(visible.length, filtered?.length ?? 0)}${
                      translated ? ` · запрос для ИИ: «${translated}»` : ''
                    }`
                  : `Показано: ${Math.min(visible.length, listRecs.length)} из ${listRecs.length}`}
              </span>
            </div>
            <div className="results-actions">
              {hits && (
                <button className="btn ghost sm" onClick={toggleAll}>
                  {filtered && filtered.length && filtered.every((h) => selected.has(h.rec.path))
                    ? 'Снять все'
                    : 'Выбрать все'}
                </button>
              )}
            </div>
          </div>

          {hits && filtered && filtered.length === 0 && (
            <div className="empty">
              <p>Ничего не найдено. Попробуйте другой запрос или снизьте порог похожести.</p>
            </div>
          )}
          {(filtered ? filtered.length > 0 : true) && (
            <>
              <PhotoGrid items={visible} scores={scores} />
              {visible.length < listRecs.length && (
                <div className="more-wrap">
                  <button className="btn" onClick={() => setLimit((l) => l + 200)}>
                    Показать ещё
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* --- Действия с выделением --- */}
      {localSel.length > 0 && (
        <div className="results-head sticky-actions">
          <div className="results-title">
            <span className="muted">
              Выделено локальных: <b>{localSel.length}</b>
            </span>
          </div>
          <div className="results-actions">
            <button className="btn primary sm" onClick={() => setRenameOpen(true)}>
              ✎ Переименовать по содержимому ({localSel.length})
            </button>
            <button className="btn sm" onClick={() => setUploadOpen(true)}>
              ⬆ Залить на Диск ({localSel.length})
            </button>
            <button className="btn ghost sm" onClick={clearSelection}>
              Снять
            </button>
          </div>
        </div>
      )}

      {/* --- Трансфер --- */}
      <TransferPanel />

      {/* --- Диалоги --- */}
      {renameOpen && <RenameDialog files={localSel} onClose={() => setRenameOpen(false)} />}
      {uploadOpen && <UploadDialog files={localSel} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
