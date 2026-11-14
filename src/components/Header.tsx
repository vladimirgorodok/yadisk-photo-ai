import { useApp } from '../state/AppContext';
import { useDevice } from '../state/DeviceContext';

export type Tab = 'disk' | 'device' | 'manager' | 'rename' | 'settings';

export function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const app = useApp();
  const device = useDevice();
  const activeJobs = device.jobs.filter(
    (j) => j.status === 'running' || j.status === 'queued',
  ).length;
  return (
    <header className="header">
      <div className="brand" onClick={() => setTab('disk')} role="button" tabIndex={0}>
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
        <button className={tab === 'disk' ? 'on' : ''} onClick={() => setTab('disk')}>
          Диск
        </button>
        <button className={tab === 'device' ? 'on' : ''} onClick={() => setTab('device')}>
          Устройство
        </button>
        <button
          className={`tab-device ${tab === 'manager' ? 'on' : ''}`}
          onClick={() => setTab('manager')}
          title="Менеджер файлов: перенос между Диском и устройством, очередь"
        >
          Менеджер
          {activeJobs > 0 && <span className="tab-badge">{activeJobs}</span>}
        </button>
        <button
          className={tab === 'rename' ? 'on' : ''}
          onClick={() => setTab('rename')}
          title="Функции переименования файлов"
        >
          Переименование
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
