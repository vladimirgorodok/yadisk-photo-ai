import { useState } from 'react';
import { SearchView } from './SearchView';
import { GroupsView } from './GroupsView';

/**
 * «Диск»: вся работа с Яндекс Диском в одном разделе —
 * поиск по содержимому и раскладка по группам переключаются сверху.
 */
export function DiskView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [sub, setSub] = useState<'search' | 'groups'>('search');
  return (
    <div className="view">
      <div className="segmented" role="tablist" aria-label="Разделы Диска">
        <button role="tab" aria-selected={sub === 'search'} className={sub === 'search' ? 'on' : ''} onClick={() => setSub('search')}>
          🔍 Поиск
        </button>
        <button role="tab" aria-selected={sub === 'groups'} className={sub === 'groups' ? 'on' : ''} onClick={() => setSub('groups')}>
          🗂 Группы
        </button>
      </div>
      {sub === 'search' ? <SearchView onOpenSettings={onOpenSettings} /> : <GroupsView />}
    </div>
  );
}
