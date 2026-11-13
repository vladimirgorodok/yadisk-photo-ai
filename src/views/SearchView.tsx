import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { embedTexts, toEnglish } from '../lib/ai';
import { dot, formatDate, plural } from '../lib/util';
import { previewCache, resetIndex } from '../lib/scan';
import { isDeviceNative } from '../lib/localfs';
import { PhotoGrid } from '../components/PhotoGrid';
import { ProgressPanel } from '../components/ProgressPanel';
import { Modal } from '../components/Modal';
import { DownloadDialog } from '../components/DownloadDialog';
import type { PhotoRec, SearchHit } from '../types';

const EXAMPLES = ['море и пляж', 'кот', 'свадьба', 'машина', 'закат', 'собака на прогулке', 'еда', 'документы'];

export function SearchView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const app = useApp();
  const { api, connected, photos, scanning, progress, progressLog, scan, cancelScan, settings, updateSettings, toast, selected, replaceSelection, clearSelection } = app;
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [allHits, setAllHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState('');
  const [translated, setTranslated] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Выделенные файлы Диска (локальные файлы не участвуют в перемещении/скачивании сюда).
  const diskSelected = useMemo(
    () => photos.filter((p) => selected.has(p.path) && p.path.startsWith('disk:')),
    [photos, selected],
  );

  const indexed = useMemo(() => photos.filter((p) => p.emb && p.emb.length).length, [photos]);
  const filtered = useMemo(() => allHits.filter((h) => h.score >= settings.minScore), [allHits, settings.minScore]);
  const visible = filtered.slice(0, limit);
  const scores = useMemo(() => new Map(filtered.map((h) => [h.rec.path, h.score])), [filtered]);
  const visibleRecs: PhotoRec[] = visible.map((h) => h.rec);
  const allSelected = filtered.length > 0 && filtered.every((h) => selected.has(h.rec.path));

  const runSearch = async (qRaw?: string) => {
    const q = (qRaw ?? query).trim();
    if (!q) return;
    if (!connected || !api) {
      toast('Сначала подключите Яндекс Диск', 'error');
      onOpenSettings();
      return;
    }
    if (!indexed) {
      toast('Сначала просканируйте Диск: ИИ должен проанализировать фотографии', 'error');
      return;
    }
    setQuery(q);
    setSearching(true);
    setTranslated(null);
    try {
      await app.preload();
      const en = await toEnglish(q);
      const [qemb] = await embedTexts([en]);
      const scored: SearchHit[] = photos
        .filter((p) => p.emb && p.emb.length === qemb.length)
        .map((rec) => ({ rec, score: dot(rec.emb!, qemb), preview: previewCache.get(rec.path) ?? rec.preview }));
      scored.sort((a, b) => b.score - a.score);
      setAllHits(scored);
      setSearched(q);
      setLimit(60);
      if (en && en.toLowerCase() !== q.toLowerCase() && /[\u0400-\u04FF]/.test(q)) setTranslated(en);
      if (!scored.length) toast('Нет проанализированных фото — обновите индекс', 'error');
    } catch (e) {
      toast((e as Error)?.message || 'Ошибка поиска', 'error');
    } finally {
      setSearching(false);
    }
  };

  const toggleAll = () => {
    if (allSelected) clearSelection();
    else
      replaceSelection(
        filtered.map((h) => ({ path: h.rec.path, name: h.rec.name, preview: previewCache.get(h.rec.path) ?? h.rec.preview })),
      );
  };

  const doReset = async () => {
    setResetting(true);
    try {
      await resetIndex();
      await app.reloadPhotos();
      setAllHits([]);
      clearSelection();
      toast('Локальный индекс очищен', 'success');
      setResetOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setResetting(false);
    }
  };

  if (!connected) {
    return (
      <div className="view">
        <div className="hero-card">
          <div className="hero-emoji">🔗</div>
          <h2>Подключите Яндекс Диск</h2>
          <p className="muted">
            Приложению нужен доступ к вашему Диску, чтобы находить фотографии и раскладывать их по папкам. Токен
            хранится только на этом устройстве.
          </p>
          <button className="btn primary" onClick={onOpenSettings}>
            Перейти в настройки
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <section className="search-box">
        <div className="search-row">
          <input
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            placeholder="Что ищем? Например: «кот на диване», «море», «свадьба»…"
            enterKeyHint="search"
          />
          <button className="btn primary" onClick={() => runSearch()} disabled={searching || scanning}>
            {searching ? 'Ищу…' : 'Найти'}
          </button>
        </div>
        {!allHits.length && (
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => runSearch(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}
        <div className="index-line">
          <span className="muted">
            В индексе: <b>{photos.length}</b> {plural(photos.length, 'фото', 'фото', 'фото')} · проанализировано ИИ:{' '}
            <b>{indexed}</b>
            {app.scanAt ? ` · обновлён ${formatDate(new Date(app.scanAt).toISOString())}` : ''}
          </span>
          <span className="index-actions">
            <button className="btn ghost sm" onClick={scan} disabled={scanning}>
              {scanning ? 'Сканирую…' : photos.length ? 'Обновить индекс' : 'Сканировать Диск'}
            </button>
            {photos.length > 0 && (
              <button className="btn ghost sm" onClick={() => setResetOpen(true)}>
                Сбросить
              </button>
            )}
          </span>
        </div>
      </section>

      {scanning && progress && (
        <ProgressPanel progress={progress} log={progressLog} onCancel={cancelScan} />
      )}
      {!scanning && app.models.loading && (
        <ProgressPanel progress={{ label: app.models.msg || 'Загрузка ИИ-моделей', done: app.models.pct, total: 100 }} />
      )}

      {!photos.length && !scanning && (
        <div className="hero-card">
          <div className="hero-emoji">🛰️</div>
          <h2>ИИ-агент готов к работе</h2>
          <p className="muted">
            Нажмите «Сканировать Диск». Агент составит список фотографий и локально проанализирует их — после этого
            можно искать по описанию. Первый анализ занимает время (модель ИИ скачивается один раз и кэшируется).
          </p>
          <button className="btn primary" onClick={scan}>
            Сканировать Диск
          </button>
        </div>
      )}

      {allHits.length > 0 && (
        <>
          <div className="results-head">
            <div className="results-title">
              <h2>Результаты: «{searched}»</h2>
              <span className="muted">
                Найдено: {filtered.length} · показано: {Math.min(visible.length, filtered.length)}
                {translated ? ` · запрос для ИИ: «${translated}»` : ''}
              </span>
            </div>
            <div className="results-actions">
              <button className="btn ghost sm" onClick={toggleAll}>
                {allSelected ? 'Снять все' : 'Выбрать все'}
              </button>
              {isDeviceNative && diskSelected.length > 0 && (
                <button className="btn ghost sm" onClick={() => setDownloadOpen(true)}>
                  ⬇ На устройство ({diskSelected.length})
                </button>
              )}
              {diskSelected.length > 0 && (
                <button className="btn primary sm" onClick={() => app.setDrawerOpen(true)}>
                  Переместить ({diskSelected.length})
                </button>
              )}
            </div>
          </div>
          <div className="threshold">
            <label htmlFor="thr">Порог похожести</label>
            <input
              id="thr"
              type="range"
              min={0}
              max={0.35}
              step={0.005}
              value={settings.minScore}
              onChange={(e) => updateSettings({ minScore: Number(e.target.value) })}
            />
            <span className="muted">{Math.round(settings.minScore * 100)}</span>
          </div>
          {filtered.length === 0 ? (
            <div className="empty">
              <p>Ничего не найдено. Попробуйте другой запрос или снизьте порог похожести.</p>
            </div>
          ) : (
            <>
              <PhotoGrid items={visibleRecs} scores={scores} />
              {visible.length < filtered.length && (
                <div className="more-wrap">
                  <button className="btn" onClick={() => setLimit((l) => l + 60)}>
                    Показать ещё
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {resetOpen && (
        <Modal
          title="Сбросить индекс?"
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setResetOpen(false)} disabled={resetting}>
                Отмена
              </button>
              <button className="btn danger" onClick={doReset} disabled={resetting}>
                {resetting ? 'Сбрасываю…' : 'Сбросить'}
              </button>
            </>
          }
        >
          <p>
            Будут удалены локальные эмбеддинги и результаты анализа (на самом Яндекс Диске ничего не удаляется).
            Следующее сканирование проанализирует фотографии заново.
          </p>
        </Modal>
      )}

      {downloadOpen && isDeviceNative && (
        <DownloadDialog files={diskSelected} onClose={() => setDownloadOpen(false)} />
      )}
    </div>
  );
}
