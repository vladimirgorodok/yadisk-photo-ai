export interface Settings {
  token: string;
  clientId: string;
  minScore: number;
  modelKey: string;
  lastFolder: string;
  /** Политика конфликтов при загрузке файлов на Диск. */
  conflictPolicy: 'skip' | 'rename' | 'overwrite';
  /** Папка устройства для скачивания с Диска. */
  downloadDir: string;
  /** Папка Диска для загрузки с устройства. */
  uploadDir: string;
  /** Последняя открытая папка в модуле «Устройство». */
  localRoot: string;
  /** Тема интерфейса. */
  theme: 'system' | 'light' | 'dark';
  /** Маски переименования для каждой функции (см. naming.nameFromMask). */
  renameMasks: { content: string; ocr: string };
}

const KEY = 'yfa:settings:v1';

export const DEFAULT_SETTINGS: Settings = {
  token: '',
  clientId: '',
  minScore: 0.14,
  modelKey: 'clip-vit-b32',
  lastFolder: 'disk:/',
  conflictPolicy: 'rename',
  downloadDir: '/storage/emulated/0/Download/Диск Фото AI',
  uploadDir: 'disk:/С устройства',
  localRoot: '/storage/emulated/0',
  theme: 'system',
  renameMasks: { content: '{date} {text}', ocr: '{text} {date}' },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* приватный режим — игнорируем */
  }
}

/** Базовый URL приложения без index.html и без hash/query. */
export function appBaseUrl(): string {
  const url = new URL(location.href);
  let p = url.pathname;
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  if (!p.endsWith('/')) p += '/';
  return url.origin + p;
}

export function oauthAuthorizeUrl(clientId: string): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem('yfa:oauthstate', state);
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: clientId.trim(),
    redirect_uri: appBaseUrl(),
    state,
    scope: 'cloud_api:disk.read cloud_api:disk.write cloud_api:disk.info',
  });
  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

/** Читает access_token из hash после редиректа OAuth и очищает адресную строку. */
export function consumeOAuthToken(): { token?: string; error?: string } | null {
  if (!location.hash) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  const token = h.get('access_token');
  const err = h.get('error_description') || h.get('error');
  if (!token && !err) return null;
  const state = h.get('state');
  const expected = sessionStorage.getItem('yfa:oauthstate');
  history.replaceState(null, '', location.pathname + location.search);
  if (!token) return { error: err || 'Яндекс не выдал токен' };
  if (expected && state && expected !== state) {
    return { error: 'Проверка OAuth-состояния не пройдена. Попробуйте подключиться ещё раз.' };
  }
  sessionStorage.removeItem('yfa:oauthstate');
  return { token };
}
