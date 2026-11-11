import { smartFetch } from './http';

const API = 'https://cloud-api.yandex.net/v1/disk';

export class DiskError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'DiskError';
    this.status = status;
  }
}

export interface YItem {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  modified?: string;
  created?: string;
  mime_type?: string;
  media_type?: string;
  md5?: string;
  preview?: string;
  resource_id?: string;
}

export interface YListResponse {
  items: YItem[];
  total: number;
}

export interface DiskInfo {
  used: number;
  total: number;
  trash?: number;
  login?: string;
}

export function nameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  if (i <= 5) return 'disk:/';
  return path.slice(0, i);
}

export function joinPath(base: string, name: string): string {
  const b = base.replace(/\/+$/, '');
  const n = name.replace(/^\/+/, '');
  return `${b}/${n}`;
}

function humanError(status: number): string {
  switch (status) {
    case 401:
      return 'Токен недействителен или истёк. Подключите Яндекс Диск заново в настройках.';
    case 403:
      return 'Нет прав на эту операцию. Проверьте, что при подключении выданы права на чтение и запись Диска.';
    case 404:
      return 'Объект не найден на Яндекс Диске.';
    case 409:
      return 'Конфликт: объект с таким именем уже существует.';
    case 429:
      return 'Слишком много запросов к API Яндекса. Подождите немного и повторите.';
    case 507:
      return 'На Диске недостаточно свободного места.';
    default:
      return `Ошибка API Яндекс Диска (${status}).`;
  }
}

export class YandexDisk {
  constructor(private token: string) {}

  private async request<T>(
    method: string,
    url: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const qs = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) qs.set(k, String(v));
      }
    }
    const full = qs.toString() ? `${url}${url.includes('?') ? '&' : '?'}${qs.toString()}` : url;
    const res = await smartFetch(full, {
      method,
      headers: {
        Authorization: `OAuth ${this.token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      let msg = humanError(res.status);
      try {
        const j = (await res.json()) as { message?: string; description?: string };
        if (j?.message) msg = `${j.message}${j.description ? `: ${j.description}` : ''}`;
        if (res.status === 401 || res.status === 403) msg = humanError(res.status);
      } catch {
        /* ignore */
      }
      throw new DiskError(msg, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }

  async info(): Promise<DiskInfo> {
    const j = await this.request<{
      used_space?: number;
      total_space?: number;
      trash_size?: number;
      user?: { login?: string; display_name?: string };
    }>('GET', `${API}/`);
    return {
      used: j?.used_space ?? 0,
      total: j?.total_space ?? 0,
      trash: j?.trash_size,
      login: j?.user?.login || j?.user?.display_name,
    };
  }

  async loginInfo(): Promise<string | null> {
    try {
      const res = await smartFetch('https://login.yandex.ru/info?format=json', {
        headers: { Authorization: `OAuth ${this.token}`, Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { login?: string; display_name?: string };
      return j?.login || j?.display_name || null;
    } catch {
      return null;
    }
  }

  async list(
    path: string,
    opts: { limit?: number; offset?: number; preview?: boolean } = {},
  ): Promise<YListResponse> {
    const data = await this.request<{
      _embedded?: { items?: YItem[]; total?: number };
    }>('GET', `${API}/resources`, {
      path,
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
      sort: 'name',
      preview_size: opts.preview === false ? undefined : 'L',
      preview_crop: false,
    });
    return {
      items: data?._embedded?.items ?? [],
      total: data?._embedded?.total ?? 0,
    };
  }

  async resource(path: string, preview = true): Promise<YItem> {
    return this.request<YItem>('GET', `${API}/resources`, {
      path,
      preview_size: preview ? 'L' : undefined,
      preview_crop: false,
    });
  }

  async createFolder(path: string): Promise<void> {
    await this.request('PUT', `${API}/resources`, { path });
  }

  async ensureFolder(path: string): Promise<void> {
    try {
      await this.createFolder(path);
    } catch (e) {
      if (e instanceof DiskError && e.status === 409) return;
      throw e;
    }
  }

  async move(from: string, to: string, overwrite = false): Promise<void> {
    const op = await this.request<{ href?: string }>('POST', `${API}/resources/move`, {
      from,
      path: to,
      overwrite,
    });
    if (op?.href) await this.waitOperation(op.href);
  }

  private async waitOperation(href: string, timeoutMs = 90_000): Promise<void> {
    const started = Date.now();
    for (;;) {
      if (Date.now() - started > timeoutMs) {
        throw new DiskError('Операция на Диске выполняется слишком долго. Проверьте результат позже.');
      }
      const res = await smartFetch(href, {
        headers: { Authorization: `OAuth ${this.token}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new DiskError(humanError(res.status), res.status);
      const j = (await res.json()) as { status?: string };
      if (j?.status === 'success') return;
      if (j?.status === 'failed') throw new DiskError('Яндекс Диск не смог выполнить операцию.');
      await new Promise((r) => setTimeout(r, 450));
    }
  }
}

export interface MoveResult {
  moved: { from: string; to: string }[];
  failed: { from: string; error: string }[];
}

/**
 * Перемещение файлов. При `overwrite = false` конфликтующие имена
 * автоматически получают суффикс «(1)», «(2)» и т.д.
 */
export async function moveFiles(
  api: YandexDisk,
  files: { path: string; name: string }[],
  targetDir: string,
  overwrite = false,
  onProgress?: (done: number, total: number, current: string) => void,
  signal?: AbortSignal,
): Promise<MoveResult> {
  const result: MoveResult = { moved: [], failed: [] };
  let done = 0;
  const total = files.length;
  let next = 0;

  const moveWithRename = async (from: string, name: string, to: string): Promise<string> => {
    await api.move(from, to, overwrite);
    return to;
  };

  const runner = async () => {
    for (;;) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= total) return;
      const f = files[i];
      const to = joinPath(targetDir, f.name);
      try {
        if (to === f.path) {
          throw new DiskError('Файл уже находится в этой папке', 409);
        }
        if (overwrite) {
          await api.move(f.path, to, true);
          result.moved.push({ from: f.path, to });
        } else {
          try {
            await moveWithRename(f.path, f.name, to);
            result.moved.push({ from: f.path, to });
          } catch (e) {
            const status = (e as DiskError)?.status;
            if (status !== 409) throw e;
            // Имя занято — пробуем «(1)», «(2)»… пока не найдём свободное.
            let ok = false;
            for (let attempt = 1; attempt <= 50 && !ok; attempt++) {
              const alt = joinPath(targetDir, conflictName(f.name, attempt));
              if (alt === f.path) continue;
              try {
                await api.move(f.path, alt, false);
                result.moved.push({ from: f.path, to: alt });
                ok = true;
              } catch (e2) {
                if ((e2 as DiskError)?.status !== 409) throw e2;
              }
            }
            if (!ok) throw new DiskError('Не удалось подобрать свободное имя для файла');
          }
        }
      } catch (e) {
        result.failed.push({ from: f.path, error: (e as Error)?.message || 'Ошибка перемещения' });
      }
      done++;
      onProgress?.(done, total, f.name);
    }
  };

  await Promise.all([runner(), runner()]);
  return result;
}

export function conflictName(name: string, attempt: number): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${base} (${attempt})${ext}`;
}
