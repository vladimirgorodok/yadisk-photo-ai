import { createStore, get, set, del, entries, clear, keys } from 'idb-keyval';
import type { IndexMeta, PhotoRec } from '../types';

const DB_NAME = 'yadisk-photo-ai';

export const photosStore = createStore(DB_NAME, 'photos');
export const kvStore = createStore(DB_NAME, 'kv');

function strip(rec: PhotoRec): PhotoRec {
  // preview URL — подписанный и временный, в базе не храним
  return rec;
}

export async function photoGet(path: string): Promise<PhotoRec | undefined> {
  return get<PhotoRec>(path, photosStore);
}

export async function photoSet(rec: PhotoRec): Promise<void> {
  await set(rec.path, strip(rec), photosStore);
}

export async function photoSetMany(recs: PhotoRec[]): Promise<void> {
  for (const rec of recs) await set(rec.path, strip(rec), photosStore);
}

export async function photoEntries(): Promise<[string, PhotoRec][]> {
  return entries<string, PhotoRec>(photosStore);
}

export async function photoDel(paths: string[]): Promise<void> {
  for (const p of paths) await del(p, photosStore);
}

export async function photoClear(): Promise<void> {
  await clear(photosStore);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return get<T>(key, kvStore);
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await set(key, value, kvStore);
}

export async function kvDel(key: string): Promise<void> {
  await del(key, kvStore);
}

export async function kvKeys(): Promise<string[]> {
  return keys(kvStore);
}
