import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';
import { DirBrowser, useLocalDir } from '../components/DirBrowser';
import { ProgressPanel } from '../components/ProgressPanel';
import { RenameDialog } from '../components/RenameDialog';
import { OcrDialog } from '../components/OcrDialog';
import { guessMime, walkImages, type DeviceFile } from '../lib/localfs';
import type { PhotoRec, Progress } from '../types';

type FnId = 'content' | 'ocr';

const FNS: { id: FnId; icon: string; name: string; desc: string }[] = [
  {
    id: 'content',
    icon: '✎',
    name: 'По содержимому',
    desc: 'ИИ описывает каждое фото (модель подписей), переводит подпись на русский и предлагает имя по маске. Подходит для фотографий без текста.',
  },
  {
    id: 'ocr',
    icon: '🔎',
    name: 'Текст на картинке',
    desc: 'Находит в папке (включая подпапки) изображения с текстом, распознаёт его офлайн и предлагает имя вида «Найденный текст ДД.ММ.ГГ» — с настоящей датой файла.',
  },
];

/** DeviceFile → PhotoRec для диалогов переименования. */
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
 * «Переименование»: реестр функций переименования. Каждая функция —
 * отдельный экран; новые функции добавляются по мере развития проекта.
 */
export function RenameView() {
  const [fn, setFn] = useState<FnId | null>(null);

  if (fn === 'content') return <ContentScreen onBack={() => setFn(null)} />;
  if (fn === 'ocr') return <OcrScreen onBack={() => setFn(null)} />;

  return (
    <div className="view">
      <div className="results-head">
        <div className="results-title">
          <h2>Функции переименования</h2>
          <span className="muted">Каждая функция — отдельный экран; список будет расширяться</span>
        </div>
      </div>
      <div className="fn-grid">
        {FNS.map((f) => (
          <button key={f.id} className="fn-card" onClick={() => setFn(f.id)}>
            <span className="fn-icon">{f.icon}</span>
            <span className="fn-name">{f.name}</span>
            <span className="fn-desc">{f.desc}</span>
            <span className="fn-go">Открыть →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="results-head">
      <div className="results-title">
        <h2>{title}</h2>
      </div>
      <div className="results-actions">
        <button className="btn ghost sm" onClick={onBack}>
          ← Все функции
        </button>
      </div>
    </div>
  );
}

/** Экран функции «По содержимому»: папка → выделение → подписи → имена. */
function ContentScreen({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const device = useDevice();
  const dir = useLocalDir(app.settings.localRoot);
  const [selected, setSelected] = useState<Map<string, DeviceFile>>(() => new Map());
  const [collecting, setCollecting] = useState<Progress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bootRef = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Первый вход: открываем последнюю папку, когда доступ выдан.
  useEffect(() => {
    if (device.access !== 'granted' || bootRef.current) return;
    bootRef.current = true;
    void dir.load(dir.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.access]);

  const toggle = (f: DeviceFile) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(f.path)) next.delete(f.path);
      else next.set(f.path, f);
      return next;
    });

  // Проиндексированные файлы текущей папки (с готовыми миниатюрами).
  const indexedHere = useMemo(
    () => device.localPhotos.filter((p) => p.path.startsWith(dir.path === '/' ? '/' : `${dir.path}/`)),
    [device.localPhotos, dir.path],
  );

  const collectAll = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setCollecting({ label: 'Собираю изображения', done: 0, total: 1 });
    try {
      const found = await walkImages(dir.path, ac.signal, (p) => setCollecting(p));
      setSelected(new Map(found.map((f) => [f.path, f])));
      app.toast(`Найдено изображений: ${found.length}`, 'success');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') app.toast((e as Error)?.message || 'Ошибка обхода папок', 'error');
    } finally {
      setCollecting(null);
      abortRef.current = null;
    }
  };

  const files = [...selected.values()].map((f) => {
    const indexed = device.localPhotos.find((p) => p.path === f.path);
    return indexed ?? dToRec(f);
  });

  if (!device.supported || device.access !== 'granted') {
    return (
      <div className="view">
        <BackBar onBack={onBack} title="✎ Переименование по содержимому" />
        <div className="hero-card">
          <div className="hero-emoji">{device.supported ? '🔐' : '📱'}</div>
          <h2>{device.supported ? 'Нужен доступ к файлам' : 'Файлы устройства — в APK'}</h2>
          <p className="muted">
            {device.supported
              ? 'Выдайте доступ «Все файлы» в разделе «Устройство» и вернитесь сюда.'
              : 'Переименование файлов устройства работает в Android-приложении: браузер не даёт доступа к файловой системе.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <BackBar onBack={onBack} title="✎ Переименование по содержимому" />
      <p className="muted">
        Выберите папку и файлы (или «Собрать всё включая подпапки») — ИИ опишет каждую картинку и
        предложит новые имена по маске <code>{app.settings.renameMasks.content}</code>. Настоящая
        дата снимка берётся из EXIF, иначе — дата файла.
      </p>

      <DirBrowser
        dir={dir}
        selectable
        selected={new Set(selected.keys())}
        onToggle={toggle}
      >
        <button className="btn ghost sm" onClick={() => void collectAll()} disabled={!!collecting}>
          {collecting ? 'Собираю…' : 'Собрать всё (папка + подпапки)'}
        </button>
        {indexedHere.length > 0 && (
          <button
            className="btn ghost sm"
            onClick={() =>
              setSelected((prev) => {
                const next = new Map(prev);
                for (const p of indexedHere) {
                  const f = dir.listing?.files.find((x) => x.path === p.path);
                  if (f) next.set(p.path, f);
                }
                return next;
              })
            }
          >
            Из индекса ({indexedHere.length})
          </button>
        )}
        {selected.size > 0 && (
          <button className="btn ghost sm" onClick={() => setSelected(new Map())}>
            Снять ({selected.size})
          </button>
        )}
        {selected.size > 0 && (
          <button className="btn primary sm" onClick={() => setDialogOpen(true)}>
            ✎ Подписать и переименовать ({selected.size})
          </button>
        )}
      </DirBrowser>

      {collecting && <ProgressPanel progress={collecting} onCancel={() => abortRef.current?.abort()} />}

      {dialogOpen && (
        <RenameDialog
          files={files}
          onClose={() => {
            setDialogOpen(false);
            setSelected(new Map());
          }}
        />
      )}
    </div>
  );
}

/** Экран функции «Текст на картинке»: папка → поиск изображений с текстом → OCR → имена. */
function OcrScreen({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const device = useDevice();
  const dir = useLocalDir(app.settings.localRoot);
  const [found, setFound] = useState<DeviceFile[] | null>(null);
  const [collecting, setCollecting] = useState<Progress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bootRef = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Первый вход: открываем последнюю папку, когда доступ выдан.
  useEffect(() => {
    if (device.access !== 'granted' || bootRef.current) return;
    bootRef.current = true;
    void dir.load(dir.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.access]);

  const collect = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setFound(null);
    setCollecting({ label: 'Собираю изображения', done: 0, total: 1 });
    try {
      const list = await walkImages(dir.path, ac.signal, (p) => setCollecting(p));
      setFound(list);
      if (!list.length) app.toast('Изображений не найдено', 'info');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') app.toast((e as Error)?.message || 'Ошибка обхода папок', 'error');
    } finally {
      setCollecting(null);
      abortRef.current = null;
    }
  };

  if (!device.supported) {
    return (
      <div className="view">
        <BackBar onBack={onBack} title="🔎 Текст на картинке" />
        <div className="hero-card">
          <div className="hero-emoji">📱</div>
          <h2>Распознавание — в APK</h2>
          <p className="muted">
            Поиск изображений с текстом и переименование по распознанному тексту работают с файлами
            устройства — в Android-приложении.
          </p>
        </div>
      </div>
    );
  }
  if (device.access !== 'granted') {
    return (
      <div className="view">
        <BackBar onBack={onBack} title="🔎 Текст на картинке" />
        <div className="hero-card">
          <div className="hero-emoji">🔐</div>
          <h2>Нужен доступ к файлам</h2>
          <p className="muted">Выдайте доступ «Все файлы» в разделе «Устройство» и вернитесь сюда.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <BackBar onBack={onBack} title="🔎 Текст на картинке" />
      <p className="muted">
        Шаг 1 — выберите папку и соберите изображения (включая подпапки). Шаг 2 — распознавание:
        картинки с осмысленным текстом получат предложение имени{' '}
        <code>{app.settings.renameMasks.ocr}</code> (дата — настоящая: EXIF, иначе дата файла;
        формат ДД.ММ.ГГ).
      </p>

      <DirBrowser dir={dir}>
        <button className="btn primary sm" onClick={() => void collect()} disabled={!!collecting}>
          {collecting ? 'Собираю…' : '1️⃣ Собрать изображения'}
        </button>
        {found && found.length > 0 && (
          <button className="btn primary sm" onClick={() => setDialogOpen(true)}>
            2️⃣ Распознать текст ({found.length})
          </button>
        )}
      </DirBrowser>

      {collecting && <ProgressPanel progress={collecting} onCancel={() => abortRef.current?.abort()} />}

      {found && !collecting && (
        <div className="index-line">
          <span className="muted">
            Найдено изображений: <b>{found.length}</b> в папке <b>{dir.path}</b>
          </span>
          <span className="index-actions">
            <button className="btn ghost sm" onClick={() => setFound(null)}>
              Сбросить
            </button>
          </span>
        </div>
      )}

      {dialogOpen && found && (
        <OcrDialog
          files={found}
          onClose={() => {
            setDialogOpen(false);
            setFound(null);
          }}
        />
      )}
    </div>
  );
}
