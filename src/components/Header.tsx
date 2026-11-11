import { useApp } from '../state/AppContext';

export type Tab = 'search' | 'groups' | 'settings';

export function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const app = useApp();
  return (
    <header className="header">
      <div className="brand" onClick={() => setTab('search')} role="button" tabIndex={0}>
        <span className="brand-logo" aria-hidden>
          <svg viewBox="0 0 48 48" width="28" height="28">
            <rect x="6" y="9" width="36" height="28" rx="7" fill="none" stroke="currentColor" strokeWidth="3" />
            <circle cx="17" cy="19" r="3.4" fill="currentColor" />
            <path d="M10 33l9-9 6 6 5-5 8 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="brand-name">
          Диск Фото <b>AI</b>
        </span>
      </div>
      <nav className="tabs" aria-label="Разделы">
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
          Поиск
        </button>
        <button className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>
          Группы
        </button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
          Настройки
        </button>
      </nav>
      <button
        className={`status ${app.connected ? 'ok' : app.settings.token ? 'warn' : ''}`}
        onClick={() => setTab('settings')}
        title="Настройки подключения"
      >
        <span className="dot" />
        <span className="status-text">
          {app.connected ? (app.user ? app.user : 'Подключено') : app.settings.token ? 'Нет связи' : 'Не подключено'}
        </span>
      </button>
    </header>
  );
}
