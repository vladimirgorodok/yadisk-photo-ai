import { useState } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { Header, type Tab } from './components/Header';
import { Drawer } from './components/Drawer';
import { ToastHost } from './components/ToastHost';
import { ProgressPanel } from './components/ProgressPanel';
import { SearchView } from './views/SearchView';
import { GroupsView } from './views/GroupsView';
import { SettingsView } from './views/SettingsView';

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('search');

  return (
    <div className="app">
      <Header tab={tab} setTab={setTab} />

      {!app.settings.token && (
        <div className="banner">
          <span>Подключите Яндекс Диск, чтобы начать.</span>
          <button className="btn primary sm" onClick={() => setTab('settings')}>
            Настройки
          </button>
        </div>
      )}
      {app.settings.token && !app.connected && !app.checking && app.connectError && (
        <div className="banner error">
          <span>{app.connectError}</span>
          <button className="btn ghost sm" onClick={() => setTab('settings')}>
            Проверить подключение
          </button>
        </div>
      )}

      {app.models.loading && (
        <div className="models-banner">
          <div className="models-line">
            <span className="pulse" />
            <span>{app.models.msg}</span>
            <span className="muted">{app.models.pct}%</span>
          </div>
          <div className="bar slim">
            <div className="bar-fill" style={{ width: `${app.models.pct}%` }} />
          </div>
        </div>
      )}

      <main className="main">
        {tab === 'search' && <SearchView onOpenSettings={() => setTab('settings')} />}
        {tab === 'groups' && <GroupsView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      {app.scanning && tab !== 'search' && tab !== 'groups' && app.progress && (
        <div className="floating-progress">
          <ProgressPanel progress={app.progress} onCancel={app.cancelScan} />
        </div>
      )}

      {app.selected.size > 0 && !app.drawerOpen && app.api && (
        <button className="fab-move" onClick={() => app.setDrawerOpen(true)}>
          Переместить ({app.selected.size})
        </button>
      )}

      <Drawer />
      <ToastHost />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
