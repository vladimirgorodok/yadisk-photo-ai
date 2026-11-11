import { get, set, del, entries, clear, keys, type UseStore } from 'idb-keyval';
import type { PhotoRec } from '../types';

const DB_NAME = 'yadisk-photo-ai';
const PHOTO_STORE = 'photos';
const KV_STORE = 'kv';

/**
 * Открывает базу и гарантирует наличие ОБОИХ хранилищ.
 *
 * Ловушка idb-keyval: createStore() открывает базу без версии и создаёт в
 * onupgradeneeded только свой стор. Если базу первым открывает другой стор
 * (например, 'photos'), то при открытии второго ('kv') апгрейд уже не
 * срабатывает — и первый реальный вызов падает с
 * «One of the specified object stores was not found». Поэтому базу открываем
 * сами и создаём сразу оба стора; если база существует, но стора не хватает
 * (неполная база, старая версия) — переоткрываем с новой версией, апгрейд
 * достроит недостающее, ничего не теряя.
 */
function openRequest(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Не удалось открыть локальную базу'));
    req.onblocked = () => reject(new Error('Локальная база заблокирована другим окном'));
  });
}

async function openOnce(): Promise<IDBDatabase> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let db = await openRequest();
      if (!db.objectStoreNames.contains(PHOTO_STORE) || !db.objectStoreNames.contains(KV_STORE)) {
        const next = db.version + 1;
        db.close();
        db = await openRequest(next);
      }
      // Если вкладка/окно закроет соединение или поднимет версию —
      // сбрасываем кэш, чтобы следующий вызов открыл базу заново.
      db.onclose = () => {
        dbp = undefined;
      };
      db.onversionchange = () => {
        db.close();
        dbp = undefined;
      };
      return db;
    } catch (e) {
      lastErr = e;
      // Гонка версий с другим соединением — пробуем ещё раз.
      if ((e as DOMException)?.name !== 'VersionError') throw e;
    }
  }
  throw lastErr;
}

let dbp: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = openOnce().catch((e) => {
      dbp = undefined; // не кешируем ошибку: следующая попытка откроет базу заново
      throw e;
    });
  }
  return dbp;
}

/** Хранилище с гарантированным созданием стора (вместо createStore из idb-keyval). */
function storeFor(storeName: string): UseStore {
  return <T,>(txMode: IDBTransactionMode, callback: (store: IDBObjectStore) => T | PromiseLike<T>): Promise<T> =>
    openDb().then((db) => callback(db.transaction(storeName, txMode).objectStore(storeName)));
}

export const photosStore = storeFor(PHOTO_STORE);
export const kvStore = storeFor(KV_STORE);

export async function photoGet(path: string): Promise<PhotoRec | undefined> {
  return get<PhotoRec>(path, photosStore);
}

export async function photoSet(rec: PhotoRec): Promise<void> {
  await set(rec.path, rec, photosStore);
}

export async function photoSetMany(recs: PhotoRec[]): Promise<void> {
  for (const rec of recs) await set(rec.path, rec, photosStore);
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
