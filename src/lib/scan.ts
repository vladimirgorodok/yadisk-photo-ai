import type { PhotoRec, Progress } from '../types';
import { YandexDisk, parentOf, type YItem } from './api';
import { photoClear, photoDel, photoSet, photoSetMany, kvSet } from './db';
import { embedImage } from './ai';
import { smartFetch } from './http';
import { abortError, isAbort, sleep } from './util';

/** Свежие подписанные ссылки на превью (живут несколько часов). */
export const previewCache = new Map<string, string>();

export const MAX_PHOTOS = 30_000;

export function isImageItem(item: YItem): boolean {
  return (
    item.type === 'file' &&
    (item.media_type === 'image' || /^image\//i.test(item.mime_type ?? ''))
  );
}

function stripPreview(rec: PhotoRec): PhotoRec {
  return rec;
}

export async function scanDisk(
  api: YandexDisk,
  oldPhotos: Map<string, PhotoRec>,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<PhotoRec[]> {
  const dirs: string[] = ['disk:/'];
  const photos: PhotoRec[] = [];
  const seen = new Set<string>();
  let dirsDone = 0;
  let dirsTotal = 1;
  let found = 0;
  let hadErrors = false;

  const listDir = async (dir: string): Promise<YItem[]> => {
    try {
      const items: YItem[] = [];
      let offset = 0;
      for (;;) {
        if (signal.aborted) throw abortError();
        const { items: page, total } = await api.list(dir, { offset, limit: 100, preview: true });
        items.push(...page);
        offset += page.length;
        if (!page.length || offset >= total) break;
      }
      return items;
    } catch (e) {
      if (isAbort(e)) throw e;
      // Нет прав на отдельную папку или она исчезла — продолжаем сканирование.
      hadErrors = true;
      console.warn('Не удалось прочитать папку', dir, e);
      return [];
    }
  };

  while (dirs.length) {
    if (signal.aborted) throw abortError();
    if (photos.length >= MAX_PHOTOS) {
      onProgress({
        label: 'Сканирую Диск',
        done: dirsDone,
        total: dirsTotal,
        detail: `Достигнут лимит ${MAX_PHOTOS} фото — индексирую первые найденные`,
      });
      break;
    }
    const batch = dirs.splice(0, 3);
    const pages = await Promise.all(batch.map((d) => listDir(d)));
    for (let bi = 0; bi < batch.length; bi++) {
      const dir = batch[bi];
      dirsDone++;
      for (const item of pages[bi]) {
        if (item.type === 'dir') {
          if (item.path === 'disk:/trash' || item.path.startsWith('disk:/trash/')) continue;
          dirs.push(item.path);
          dirsTotal++;
        } else if (isImageItem(item)) {
          const path = item.path;
          const md5 = item.md5 ?? '';
          const prev = oldPhotos.get(path);
          const unchanged = !!prev && prev.md5 === md5 && prev.size === (item.size ?? 0);
          const rec: PhotoRec = {
            path,
            name: item.name,
            dir: parentOf(path),
            size: item.size ?? 0,
            modified: item.modified ?? '',
            md5,
            mime: item.mime_type ?? '',
            preview: item.preview,
            emb: unchanged ? prev!.emb : undefined,
            embModel: unchanged ? prev!.embModel : undefined,
            embAt: unchanged ? prev!.embAt : undefined,
            faces: unchanged ? prev!.faces : undefined,
            facesDone: unchanged ? prev!.facesDone : false,
            facesModel: unchanged ? prev!.facesModel : undefined,
            cat: unchanged ? prev!.cat : undefined,
          };
          if (item.preview) previewCache.set(path, item.preview);
          photos.push(rec);
          seen.add(path);
          found++;
        }
      }
      onProgress({
        label: 'Сканирую Диск',
        done: dirsDone,
        total: dirsTotal,
        detail: `Найдено фото: ${found}`,
      });
    }
  }

  // Чистим из базы файлы, которых больше нет на Диске.
  // Если часть папок не прочиталась, не рискуем удалять их содержимое.
  const stale: string[] = [];
  if (!hadErrors) {
    for (const [path] of oldPhotos) {
      if (!seen.has(path)) stale.push(path);
    }
  }
  if (stale.length) await photoDel(stale);

  // Пакетное сохранение (пачками, чтобы не забивать память)
  for (let i = 0; i < photos.length; i += 60) {
    await photoSetMany(photos.slice(i, i + 60));
  }

  await kvSet('indexMeta', {
    scanAt: Date.now(),
    count: photos.length,
    modelKey: 'clip-vit-b32',
  });
  return photos;
}

export function recMap(photos: PhotoRec[]): Map<string, PhotoRec> {
  return new Map(photos.map((p) => [p.path, p]));
}

/** Получить blob превью по пути (обновляет подписанную ссылку при необходимости). */
export async function previewBlob(api: YandexDisk, path: string): Promise<Blob> {
  const tryFetch = async (url: string): Promise<Blob> => {
    const res = await smartFetch(url);
    if (!res.ok) throw new Error(`Превью недоступно (${res.status})`);
    return res.blob();
  };
  const cached = previewCache.get(path);
  if (cached) {
    try {
      return await tryFetch(cached);
    } catch {
      previewCache.delete(path);
    }
  }
  const item = await api.resource(path, true);
  if (!item.preview) throw new Error('У файла нет превью');
  previewCache.set(path, item.preview);
  return tryFetch(item.preview);
}

/** Достраивает CLIP-эмбеддинги для фотографий (с кэшем в IndexedDB). */
export async function ensureEmbeddings(
  api: YandexDisk,
  photos: PhotoRec[],
  modelKey: string,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<void> {
  const todo = photos.filter((p) => !p.emb || p.embModel !== modelKey);
  if (!todo.length) return;
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    if (signal.aborted) throw abortError();
    const rec = todo[i];
    onProgress({
      label: 'ИИ анализирует фотографии',
      done: i,
      total: todo.length,
      detail: rec.name,
    });
    try {
      const blob = await previewBlob(api, rec.path);
      rec.emb = await embedImage(blob);
      rec.embModel = modelKey;
      rec.embAt = Date.now();
      await photoSet(stripPreview(rec));
    } catch (e) {
      failed++;
      if (failed === 1) console.warn('Не удалось обработать', rec.path, e);
    }
    await sleep(0);
  }
  onProgress({
    label: 'ИИ анализирует фотографии',
    done: todo.length,
    total: todo.length,
    detail: failed ? `Не удалось обработать: ${failed}` : 'Готово',
  });
  await kvSet('aiModelKey', modelKey);
}

export async function resetIndex(): Promise<void> {
  await photoClear();
  previewCache.clear();
  await kvSet('indexMeta', null);
}
