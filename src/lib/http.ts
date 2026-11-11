import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/**
 * fetch, который внутри APK ходит через нативный HTTP (обходит CORS webview).
 * В браузере — обычный fetch (API Яндекса и превью отдают CORS-заголовки).
 */
export async function smartFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isNative) return fetch(url, init);
  return nativeFetch(url, init);
}

const IMAGE_RE = /downloader\.disk\.yandex\.ru|content_type=image|\.(jpe?g|png|webp|gif|bmp|heic|avif)(\?|$)/i;

async function nativeFetch(url: string, init: RequestInit): Promise<Response> {
  const { CapacitorHttp } = await import('@capacitor/core');
  const headers: Record<string, string> = {};
  new Headers(init.headers ?? {}).forEach((v, k) => {
    headers[k] = v;
  });
  const wantsImage = IMAGE_RE.test(url);
  let data: unknown;
  if (init.body && typeof init.body === 'string') {
    try {
      data = JSON.parse(init.body);
    } catch {
      data = init.body;
    }
  }
  const res = await CapacitorHttp.request({
    url,
    method: (init.method ?? 'GET').toUpperCase(),
    headers,
    data,
    responseType: wantsImage ? 'blob' : 'text',
    connectTimeout: 45_000,
    readTimeout: 120_000,
  });
  const outHeaders = new Headers();
  Object.entries(res.headers ?? {}).forEach(([k, v]) => outHeaders.set(k, String(v)));
  const body: BodyInit | null = wantsImage
    ? ((res.data as Blob) ?? null)
    : typeof res.data === 'string'
      ? res.data
      : res.data == null
        ? null
        : JSON.stringify(res.data);
  return new Response(body, { status: res.status, headers: outHeaders });
}
