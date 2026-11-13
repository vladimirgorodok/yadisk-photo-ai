import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import type { Progress } from '../types';
import { abortError, isAbort } from './util';

/** Модуль «Устройство» доступен только в APK (в PWA нет доступа к файловой системе). */
export const isDeviceNative = Capacitor.isNativePlatform();

interface StorageAccessPlugin {
  check(): Promise<{ sdk: number; granted: boolean }>;
  request(): Promise<{ granted: boolean; opened: boolean; error?: string }>;
}

const StorageAccess = registerPlugin<StorageAccessPlugin>('StorageAccess');

export type AccessState = 'granted' | 'denied' | 'unknown';

export async function checkAccess(): Promise<{ granted: boolean; sdk: number }> {
  if (!isDeviceNative) return { granted: false, sdk: 0 };
  try {
    return await StorageAccess.check();
  } catch {
    return { granted: false, sdk: 0 };
  }
}

/** Запрашивает доступ; на Android 11+ открывает экран «Файлы и медиа» в настройках. */
export async function requestAccess(): Promise<{ granted: boolean; opened: boolean; error?: string }> {
  if (!isDeviceNative) return { granted: false, opened: false };
  try {
    return await StorageAccess.request();
  } catch (e) {
    return { granted: false, opened: false, error: (e as Error)?.message };
  }
}

export interface DeviceFile {
  path: string;
  name: string;
  dir: string;
  size: number;
  mtime: number;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm)$/i;

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

export function isVideoName(name: string): boolean {
  return VIDEO_EXT.test(name);
}

export function joinLocal(dir: string, name: string): string {
  const d = dir.replace(/\/+$/, '');
  return `${d}/${name.replace(/^\/+/, '')}`;
}

export function parentLocal(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

export function guessMime(name: string): string {
  const e = extOf(name).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  if (e === '.bmp') return 'image/bmp';
  if (e === '.avif') return 'image/avif';
  if (/\.heif?$/.test(e)) return 'image/heif';
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.mp4') return 'video/mp4';
  if (e === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

/** Список файлов и папок (не рекурсивно). */
export async function listDir(path: string): Promise<{ dirs: DeviceFile[]; files: DeviceFile[] }> {
  const res = await Filesystem.readdir({ path });
  const dirs: DeviceFile[] = [];
  const files: DeviceFile[] = [];
  for (const f of res.files) {
    const full = joinLocal(path, f.name);
    const item: DeviceFile = {
      path: full,
      name: f.name,
      dir: path,
      size: f.size ?? 0,
      mtime: f.mtime ?? 0,
    };
    if (f.type === 'directory') {
      if (!f.name.startsWith('.')) dirs.push(item);
    } else if (!f.name.startsWith('.')) {
      files.push(item);
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { dirs, files };
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path });
    return true;
  } catch {
    return false;
  }
}

export async function mkdirp(path: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path, recursive: true });
  } catch {
    /* уже существует */
  }
}

export async function deleteFile(path: string): Promise<void> {
  await Filesystem.deleteFile({ path });
}

/** Переименование. Бросает ошибку, если цель существует или нет прав. */
export async function renameFile(from: string, to: string): Promise<void> {
  await Filesystem.rename({ from, to });
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Читает файл целиком как Blob (для миниатюр и ИИ-анализа). */
export async function readBlob(path: string, mime = 'application/octet-stream'): Promise<Blob> {
  // Без encoding плагин возвращает бинарные данные в base64.
  const res = await Filesystem.readFile({ path });
  return base64ToBlob(res.data as string, mime);
}

/** Читает файл и возвращает Uint8Array (для md5). */
export async function readBytes(path: string): Promise<Uint8Array> {
  const res = await Filesystem.readFile({ path });
  const bin = atob(res.data as string);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Делает JPEG-миниатюру указанного размера. Бросает ошибку, если формат не декодируется. */
export async function makeThumb(blob: Blob, max = 256): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!out) throw new Error('Не удалось создать миниатюру');
  return out;
}

const SKIP_DIRS = new Set(['Android', 'Android/data', 'LOST.DIR', '.thumbnails']);

/**
 * Рекурсивный обход папки в поиске изображений.
 * Недоступные папки пропускаются (на правах «все файлы» их обычно не бывает).
 */
export async function walkImages(
  root: string,
  signal: AbortSignal,
  onProgress: (p: Progress) => void,
): Promise<DeviceFile[]> {
  const out: DeviceFile[] = [];
  const stack: string[] = [root];
  const seen = new Set<string>([root]);
  let dirsDone = 0;
  let dirsTotal = 1;
  let errors = 0;

  while (stack.length) {
    if (signal.aborted) throw abortError();
    const dir = stack.pop()!;
    let entries: { dirs: DeviceFile[]; files: DeviceFile[] };
    try {
      entries = await listDir(dir);
    } catch {
      errors++;
      dirsDone++;
      continue;
    }
    dirsDone++;
    for (const f of entries.files) {
      if (isImageName(f.name)) out.push(f);
    }
    for (const d of entries.dirs) {
      const rel = d.path.slice(root.length).replace(/^\//, '');
      if (SKIP_DIRS.has(rel) || seen.has(d.path)) continue;
      seen.add(d.path);
      stack.push(d.path);
      dirsTotal++;
    }
    if (dirsDone % 3 === 0 || !stack.length) {
      onProgress({
        label: 'Сканирую папки устройства',
        done: dirsDone,
        total: dirsTotal,
        detail: `Найдено изображений: ${out.length}${errors ? `, пропущено папок: ${errors}` : ''}`,
      });
    }
    // Небольшая пауза, чтобы не блокировать UI надолго
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress({
    label: 'Сканирую папки устройства',
    done: dirsDone,
    total: dirsTotal,
    detail: `Найдено изображений: ${out.length}`,
  });
  return out;
}

/** Кэш object-URL для локальных миниатюр (Blob из IndexedDB). */
const thumbUrls = new Map<string, string>();

export function localThumbUrl(path: string, thumb: Blob): string {
  const cached = thumbUrls.get(path);
  if (cached) return cached;
  const url = URL.createObjectURL(thumb);
  thumbUrls.set(path, url);
  return url;
}

export function dropLocalThumbUrl(path: string): void {
  const url = thumbUrls.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    thumbUrls.delete(path);
  }
}

export function clearLocalThumbUrls(): void {
  for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
  thumbUrls.clear();
}

export { isAbort };
