import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { appBaseUrl, oauthAuthorizeUrl } from '../lib/settings';
import { photoClear, kvSet } from '../lib/db';
import { resetIndex } from '../lib/scan';
import { copyToClipboard, formatBytes, formatDate } from '../lib/util';
import { isNative } from '../lib/http';
import { Modal } from '../components/Modal';

export function SettingsView() {
  const app = useApp();
  const { api, connected, checking, connectError, user, disk, settings, updateSettings, toast, photos, scanAt, scanning } = app;
  const [tokenDraft, setTokenDraft] = useState(settings.token);
  const [showToken, setShowToken] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);

  const redirect = appBaseUrl();

  const refreshCacheInfo = useCallback(async () => {
    try {
      if (!navigator.storage?.estimate) return;
      const est = await navigator.storage.estimate();
      setCacheBytes(est.usage ?? null);
    } catch {
      setCacheBytes(null);
    }
  }, []);

  useEffect(() => {
    void refreshCacheInfo();
  }, [refreshCacheInfo, photos.length]);

  const copy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    toast(ok ? `${label} скопирован` : 'Не удалось скопировать', ok ? 'success' : 'error');
  };

  const startOAuth = () => {
    const id = settings.clientId.trim();
    if (!id) {
      toast('Укажите Client ID приложения Яндекс OAuth', 'error');
      return;
    }
    location.href = oauthAuthorizeUrl(id);
  };

  const saveToken = () => {
    const t = tokenDraft.trim();
    if (!t) {
      toast('Вставьте OAuth-токен Яндекс Диска', 'error');
      return;
    }
    updateSettings({ token: t });
    toast('Токен сохранён', 'success');
  };

  const disconnect = () => {
    updateSettings({ token: '' });
    setTokenDraft('');
    toast('Яндекс Диск отключён. Токен удалён с устройства.', 'info');
  };

  const clearAiCache = async () => {
    setClearing(true);
    try {
      await photoClear();
      await kvSet('indexMeta', null);
      if (typeof caches !== 'undefined') {
        for (const name of await caches.keys()) {
          await caches.delete(name);
        }
      }
      await app.reloadPhotos();
      await refreshCacheInfo();
      toast('ИИ-кэш и локальный индекс очищены', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setClearing(false);
    }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      await resetIndex();
      await app.reloadPhotos();
      setResetOpen(false);
      toast('Локальный индекс очищен', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setResetting(false);
    }
  };

  const usedPct = disk && disk.total ? Math.min(100, Math.round((disk.used / disk.total) * 100)) : 0;
  const analyzed = photos.filter((p) => p.emb).length;

  return (
    <div className="view">
      <section className="panel">
        <h2>Подключение к Яндекс Диску</h2>

        {connected ? (
          <div className="connected-box">
            <div className="conn-row">
              <span className="dot ok" />
              <div>
                <div>
                  Подключено{user ? <> как <b>{user}</b></> : ''}
                </div>
                {disk && (
                  <div className="muted small">
                    Занято {formatBytes(disk.used)} из {formatBytes(disk.total)}
                    {disk.trash ? ` · корзина ${formatBytes(disk.trash)}` : ''}
                  </div>
                )}
              </div>
              <button className="btn ghost sm" onClick={disconnect}>
                Отключиться
              </button>
            </div>
            {disk && disk.total > 0 && (
              <div className="bar slim">
                <div className="bar-fill" style={{ width: `${usedPct}%` }} />
              </div>
            )}
            <div className="token-row">
              <input
                className="mono"
                readOnly
                value={
                  showToken
                    ? settings.token
                    : settings.token
                      ? `${settings.token.slice(0, 6)}••••••••••••${settings.token.slice(-4)}`
                      : ''
                }
              />
              <button className="btn ghost sm" onClick={() => setShowToken((v) => !v)}>
                {showToken ? 'Скрыть' : 'Показать'}
              </button>
              <button className="btn ghost sm" onClick={() => copy(settings.token, 'Токен')}>
                Копировать
              </button>
            </div>
            <p className="muted small">
              Токен хранится только в этом браузере/приложении. Для APK-версии скопируйте токен здесь и вставьте в
              настройках приложения на телефоне.
            </p>
          </div>
        ) : (
          <div className={connectError ? 'conn-error' : 'muted'}>
            {checking
              ? 'Проверяю подключение…'
              : connectError
                ? connectError
                : 'Диск не подключён. Подключите его по OAuth или вставьте токен вручную.'}
          </div>
        )}

        <div className="conn-grid">
          <div>
            <label className="field">
              <span>Client ID приложения Яндекс OAuth</span>
              <input
                value={settings.clientId}
                onChange={(e) => updateSettings({ clientId: e.target.value })}
                placeholder="например, 8f3a1c9d2b4e4f7a9c1d"
              />
            </label>
            <div className="field">
              <span>Redirect URI (укажите при регистрации приложения)</span>
              <div className="token-row">
                <input className="mono" readOnly value={redirect} />
                <button className="btn ghost sm" onClick={() => copy(redirect, 'Redirect URI')}>
                  Копировать
                </button>
              </div>
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={startOAuth}>
                Подключить через Яндекс
              </button>
              <a className="btn ghost" href="https://oauth.yandex.ru/client/new" target="_blank" rel="noreferrer">
                Создать приложение
              </a>
            </div>
            {isNative && (
              <p className="muted small">
                В APK OAuth-редирект недоступен: получите токен в веб-версии (кнопка «Показать» → «Копировать») и
                вставьте его ниже.
              </p>
            )}
          </div>

          <div>
            <label className="field">
              <span>Ручной ввод OAuth-токена</span>
              <textarea
                className="mono"
                rows={3}
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="y0_AgAAAA…"
              />
            </label>
            <div className="btn-row">
              <button className="btn" onClick={saveToken}>
                Сохранить токен
              </button>
              {settings.token && (
                <button className="btn ghost" onClick={disconnect}>
                  Удалить токен
                </button>
              )}
            </div>
            <p className="muted small">
              Токен можно получить на странице OAuth Яндекса или в веб-версии этого приложения. Права:{' '}
              <code>cloud_api:disk.read</code>, <code>cloud_api:disk.write</code>, <code>cloud_api:disk.info</code>.
            </p>
          </div>
        </div>

        <details className="help">
          <summary>Как зарегистрировать приложение Яндекс OAuth</summary>
          <ol>
            <li>
              Откройте <a href="https://oauth.yandex.ru/client/new" target="_blank" rel="noreferrer">oauth.yandex.ru</a>{' '}
              и создайте приложение.
            </li>
            <li>
              Платформа — <b>Веб-сервисы</b>. Redirect URI — скопируйте значение выше (<code>{redirect}</code>).
            </li>
            <li>
              В разделе доступов включите <b>Яндекс Диск</b>: чтение, запись, информация о Диске.
            </li>
            <li>Скопируйте <b>Client ID</b> и вставьте в поле выше, затем нажмите «Подключить через Яндекс».</li>
          </ol>
          <p className="muted small">
            Redirect URI должен совпадать символ в символ, включая завершающий «/». Если приложение открыто по другому
            адресу (например, локально), используйте ручной ввод токена.
          </p>
        </details>
      </section>

      <section className="panel">
        <h2>ИИ-модели и кэш</h2>
        <p className="muted">
          Всё распознавание выполняется локально: CLIP-модель для поиска по описанию, face-api — для лиц, компактный
          переводчик — для русских запросов. Модели скачиваются один раз (~150–250 МБ) и кэшируются.
        </p>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-value">{app.models.loaded ? 'Готовы' : app.models.loading ? 'Загрузка…' : 'Не загружены'}</div>
            <div className="stat-label">ИИ-модели</div>
          </div>
          <div className="stat">
            <div className="stat-value">{analyzed}</div>
            <div className="stat-label">фото проанализировано</div>
          </div>
          <div className="stat">
            <div className="stat-value">{cacheBytes != null ? formatBytes(cacheBytes) : '—'}</div>
            <div className="stat-label">занято на устройстве</div>
          </div>
        </div>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => app.preload().then(() => toast('Модели загружены', 'success')).catch((e) => toast((e as Error).message, 'error'))}
            disabled={app.models.loading}
          >
            {app.models.loading ? app.models.msg : 'Загрузить модели сейчас'}
          </button>
          <button className="btn ghost" onClick={clearAiCache} disabled={clearing}>
            {clearing ? 'Очищаю…' : 'Очистить ИИ-кэш и индекс'}
          </button>
        </div>
        {app.models.loading && (
          <div className="bar slim">
            <div className="bar-fill" style={{ width: `${app.models.pct}%` }} />
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Локальный индекс</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-value">{photos.length}</div>
            <div className="stat-label">фото найдено на Диске</div>
          </div>
          <div className="stat">
            <div className="stat-value">{scanAt ? formatDate(new Date(scanAt).toISOString()) : '—'}</div>
            <div className="stat-label">последнее сканирование</div>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={app.scan} disabled={scanning || !api}>
            {scanning ? 'Сканирую…' : 'Обновить индекс'}
          </button>
          <button className="btn ghost" onClick={() => setResetOpen(true)} disabled={!photos.length}>
            Сбросить индекс
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>О приложении</h2>
        <p className="muted">
          <b>Диск Фото AI</b> — PWA и Android-приложение: ИИ-поиск фотографий по описанию на Яндекс Диске,
          перемещение выбранных файлов в любую папку и группировка лиц, животных и сюжетов. Работает без сервера:
          запросы идут напрямую в API Яндекс Диска, распознавание — на устройстве.
        </p>
        <ul className="muted small">
          <li>Версия 1.0.0</li>
          <li>
            Исходный код:{' '}
            <a href="https://github.com/vladimirgorodok/yadisk-photo-ai" target="_blank" rel="noreferrer">
              github.com/vladimirgorodok/yadisk-photo-ai
            </a>
          </li>
          <li>Установка как приложение: меню браузера → «Установить приложение» / «На главный экран».</li>
          <li>APK: собирается в GitHub Actions, ссылка — в разделе Releases репозитория.</li>
        </ul>
      </section>

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
          <p>Локальные данные анализа будут удалены. На Яндекс Диске ничего не изменится.</p>
        </Modal>
      )}
    </div>
  );
}
