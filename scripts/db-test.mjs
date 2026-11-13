/**
 * Регрессионный тест локальной базы (src/lib/db.ts).
 *
 * mode=fresh — свежая база: все стора (photos, kv, local, jobs) должны
 *              создаться с первого открытия (раньше idb-keyval создавал
 *              только первый использованный стор).
 * mode=heal   — база в состоянии, как на телефоне пользователя: есть только
 *              стор 'photos', остальных нет. Лечение должно достроить их
 *              версией выше и НЕ потерять данные 'photos'.
 *
 * Запуск: node scripts/db-test.mjs fresh | heal
 */
import 'fake-indexeddb/auto';

const DB_NAME = 'yadisk-photo-ai';
const mode = process.argv[2] ?? 'fresh';

const openRaw = (version, upgrade) =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const writePhoto = (db, path) =>
  new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ path, name: path.split('/').pop(), dir: 'disk:/', size: 1, modified: '', md5: '', mime: 'image/jpeg' }, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

if (mode === 'heal') {
  // 1. Состояние сломанной базы: только стор photos, как после первого
  //    открытия старым кодом (idb-keyval создавал лишь свой стор).
  let db = await openRaw(1, (d) => d.createObjectStore('photos'));
  await writePhoto(db, 'disk:/old.jpg'); // данные, которые обязаны сохраниться
  db.close();

  // 2. Новый код: первая же kv-операция раньше падала с
  //    "One of the specified object stores was not found".
  const dbmod = await import('./.tmp/lib/db.js');
  await dbmod.kvSet('indexMeta', { scanAt: 123, count: 3 });
  const meta = await dbmod.kvGet('indexMeta');
  if (!meta || meta.count !== 3) throw new Error('kv не записался/не прочитался');

  const list = await dbmod.photoEntries();
  const paths = list.map(([k]) => k);
  if (!paths.includes('disk:/old.jpg')) {
    throw new Error(`данные photos потеряны при лечении: ${JSON.stringify(paths)}`);
  }

  // Сторы нового модуля «Устройство»: local и jobs достраиваются тем же лечением.
  await dbmod.localSet({ path: '/storage/emulated/0/a.jpg', name: 'a.jpg', dir: '/storage/emulated/0', size: 5, modified: '', md5: '', mime: 'image/jpeg', source: 'local' });
  const local = await dbmod.localEntries();
  if (local.length !== 1) throw new Error('local-стор не достроен/не работает');
  await dbmod.jobSet({ id: 'j1', kind: 'download', src: 'disk:/x.jpg', dst: '/x.jpg', name: 'x.jpg', status: 'queued', bytesDone: 0, bytesTotal: 0, createdAt: 1 });
  const jobs = await dbmod.jobEntries();
  if (jobs.length !== 1) throw new Error('jobs-стор не достроен/не работает');
  const after = await dbmod.photoEntries();
  if (after.length !== 1) throw new Error('photos пострадали от новых сторов');

  console.log('HEAL OK: kv/local/jobs достроены, данные photos целы, чтение/запись работают');
} else {
  // Свежая база: photoEntries() первым открывает базу — все стора обязаны
  // появиться сразу, а не «когда-нибудь потом».
  const dbmod = await import('./.tmp/lib/db.js');
  const empty = await dbmod.photoEntries();
  if (empty.length !== 0) throw new Error('свежая база не пуста?');
  await dbmod.kvSet('indexMeta', { scanAt: 1, count: 0 });
  const meta = await dbmod.kvGet('indexMeta');
  if (!meta || meta.scanAt !== 1) throw new Error('kv не работает на свежей базе');
  await dbmod.photoSet({ path: 'disk:/new.jpg', name: 'new.jpg', dir: 'disk:/', size: 2, modified: '', md5: '', mime: 'image/jpeg' });
  const list = await dbmod.photoEntries();
  if (list.length !== 1) throw new Error('photoSet не сработал');
  await dbmod.localSet({ path: '/b.jpg', name: 'b.jpg', dir: '/', size: 1, modified: '', md5: '', mime: 'image/jpeg', source: 'local' });
  if ((await dbmod.localEntries()).length !== 1) throw new Error('local не работает на свежей базе');
  await dbmod.jobSet({ id: 'j2', kind: 'upload', src: '/b.jpg', dst: 'disk:/b.jpg', name: 'b.jpg', status: 'queued', bytesDone: 0, bytesTotal: 0, createdAt: 1 });
  if ((await dbmod.jobEntries()).length !== 1) throw new Error('jobs не работает на свежей базе');
  console.log('FRESH OK: все стора (photos/kv/local/jobs) созданы с первого открытия');
}
