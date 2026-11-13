import { FileTransfer } from '@capacitor/file-transfer';
import { Filesystem } from '@capacitor/filesystem';
import SparkMD5 from 'spark-md5';
import { YandexDisk, DiskError, conflictName } from './api';
import { jobSet, jobEntries, jobDel } from './db';
import { joinLocal, parentLocal, guessMime, exists, mkdirp, deleteFile, readBytes } from './localfs';
import { conflictLocalName } from './naming';
import { uid } from './util';
import type { TransferJob } from '../types';

/**
 * Очередь «Трансфер»: копирование файлов между Яндекс Диском и устройством.
 *
 * Принципы: копия (оригинал остаётся, пока пользователь явно не попросит
 * удалить его после проверки md5), последовательное выполнение, состояние
 * хранится в IndexedDB и переживает перезапуск приложения.
 */

export type ConflictPolicy = 'skip' | 'rename' | 'overwrite';

type Listener = (jobs: TransferJob[]) => void;

let jobs: TransferJob[] = [];
const listeners = new Set<Listener>();
let pumping = false;
let paused = false;
let apiRef: YandexDisk | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;
let progressBound = false;
let active: { id: string; url: string } | null = null;
let lastPersist = 0;

export function initTransfer(api: YandexDisk | null): void {
  apiRef = api;
}

export function subscribeTransfer(cb: Listener): () => void {
  listeners.add(cb);
  cb([...jobs]);
  return () => listeners.delete(cb);
}

function emit(): void {
  const snapshot = [...jobs];
  for (const cb of listeners) cb(snapshot);
}

async function save(job: TransferJob, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastPersist < 800) {
    // отложенное сохранение: не долбим IndexedDB на каждом прогресс-событии
    setTimeout(() => void jobSet(job).catch(() => {}), 900);
    return;
  }
  lastPersist = now;
  await jobSet(job);
}

export async function loadJobs(): Promise<void> {
  const entries = await jobEntries();
  jobs = entries
    .map(([, j]) => j)
    .sort((a, b) => a.createdAt - b.createdAt);
  // Восстановление после аварийного завершения: прерванная задача → в очередь.
  let changed = false;
  for (const j of jobs) {
    if (j.status === 'running') {
      j.status = 'queued';
      changed = true;
    }
  }
  if (changed) await persistAll();
  emit();
}

async function persistAll(): Promise<void> {
  for (const j of jobs) await jobSet(j);
}

function nextId(): string {
  return uid();
}

export interface DownloadRequest {
  /** Путь на Яндекс Диске (disk:/…). */
  path: string;
  name: string;
  size?: number;
  md5?: string;
}

export interface EnqueueResult {
  added: number;
  skipped: number;
}

/** Скачивание: копия файла с Диска в папку устройства (конфликты получают «(1)»). */
export async function enqueueDownloads(
  reqs: DownloadRequest[],
  targetDir: string,
  deleteAfter: boolean,
): Promise<EnqueueResult> {
  let added = 0;
  let skipped = 0;
  for (const r of reqs) {
    let dst = joinLocal(targetDir, r.name);
    if (await exists(dst)) {
      let alt: string | null = null;
      for (let i = 1; i <= 50; i++) {
        const cand = joinLocal(targetDir, conflictLocalName(r.name, i));
        if (!(await exists(cand))) {
          alt = cand;
          break;
        }
      }
      if (!alt) {
        skipped++;
        continue;
      }
      dst = alt;
    }
    const job: TransferJob = {
      id: nextId(),
      kind: 'download',
      src: r.path,
      dst,
      name: r.name,
      status: 'queued',
      bytesDone: 0,
      bytesTotal: r.size ?? 0,
      deleteAfter,
      md5Expected: r.md5 || undefined,
      createdAt: Date.now(),
    };
    jobs.push(job);
    await jobSet(job);
    added++;
  }
  emit();
  void pump();
  return { added, skipped };
}

async function diskPathExists(path: string): Promise<boolean> {
  if (!apiRef) throw new Error('Яндекс Диск не подключён');
  try {
    await apiRef.resource(path, false);
    return true;
  } catch (e) {
    if (e instanceof DiskError && e.status === 404) return false;
    throw e;
  }
}

export interface UploadRequest {
  /** Локальный путь (/storage/emulated/0/…). */
  path: string;
  name: string;
  size?: number;
}

/** Загрузка: копия локального файла на Диск с проверкой md5 после передачи. */
export async function enqueueUploads(
  reqs: UploadRequest[],
  diskDir: string,
  policy: ConflictPolicy,
  deleteLocal: boolean,
): Promise<EnqueueResult & { skippedNames: string[] }> {
  let added = 0;
  let skipped = 0;
  const skippedNames: string[] = [];
  for (const r of reqs) {
    const base = `${diskDir.replace(/\/+$/, '')}/${r.name.replace(/^\/+/, '')}`;
    let dst = base;
    let overwrite = false;
    if (await diskPathExists(base)) {
      if (policy === 'skip') {
        skipped++;
        skippedNames.push(r.name);
        continue;
      }
      if (policy === 'overwrite') {
        dst = base;
        overwrite = true;
      } else {
        let alt: string | null = null;
        for (let i = 1; i <= 50; i++) {
          const cand = `${diskDir.replace(/\/+$/, '')}/${conflictName(r.name, i)}`;
          if (!(await diskPathExists(cand))) {
            alt = cand;
            break;
          }
        }
        if (!alt) {
          skipped++;
          skippedNames.push(r.name);
          continue;
        }
        dst = alt;
      }
    }
    const job: TransferJob = {
      id: nextId(),
      kind: 'upload',
      src: r.path,
      dst,
      name: r.name,
      status: 'queued',
      bytesDone: 0,
      bytesTotal: r.size ?? 0,
      deleteLocal,
      overwrite,
      createdAt: Date.now(),
    };
    jobs.push(job);
    await jobSet(job);
    added++;
  }
  emit();
  void pump();
  return { added, skipped, skippedNames };
}

export function setTransferPaused(v: boolean): void {
  paused = v;
  emit();
  if (!v) void pump();
}

/** Возобновляет отложенные задачи (после перезапуска приложения). */
export function resumeQueue(): void {
  if (paused) return;
  if (jobs.some((j) => j.status === 'queued')) void pump();
}

export function isTransferPaused(): boolean {
  return paused;
}

export async function cancelJob(id: string): Promise<void> {
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  if (j.status === 'running') return; // нативная передача не отменяется на лету
  if (j.status === 'done' || j.status === 'canceled') return;
  j.status = 'canceled';
  j.finishedAt = Date.now();
  await jobSet(j);
  emit();
}

export async function retryJob(id: string): Promise<void> {
  const j = jobs.find((x) => x.id === id);
  if (!j || j.status === 'running' || j.status === 'queued') return;
  j.status = 'queued';
  j.error = undefined;
  j.note = undefined;
  j.bytesDone = 0;
  j.finishedAt = undefined;
  await jobSet(j);
  emit();
  void pump();
}

export async function clearFinishedJobs(): Promise<void> {
  const removable = jobs.filter((j) => j.status === 'done' || j.status === 'canceled');
  if (!removable.length) return;
  await jobDel(removable.map((j) => j.id));
  jobs = jobs.filter((j) => !removable.includes(j));
  emit();
}

// --- Выполнение ---

async function bindProgress(): Promise<void> {
  if (progressBound) return;
  progressBound = true;
  try {
    await FileTransfer.addListener('progress', (p) => {
      if (!active || p.url !== active.url) return;
      const job = jobs.find((j) => j.id === active!.id);
      if (!job) return;
      job.bytesDone = p.bytes;
      if (p.lengthComputable && p.contentLength) job.bytesTotal = p.contentLength;
      void save(job);
      emit();
    });
  } catch {
    /* прогресс недоступен — не страшно */
  }
}

async function acquireWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (!wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* не поддерживается */
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

async function pump(): Promise<void> {
  if (pumping || paused) return;
  pumping = true;
  try {
    await acquireWakeLock();
    for (;;) {
      if (paused) break;
      const job = jobs.find((j) => j.status === 'queued');
      if (!job) break;
      await runJob(job);
    }
  } finally {
    pumping = false;
    active = null;
    await releaseWakeLock();
    emit();
  }
}

async function runJob(job: TransferJob): Promise<void> {
  job.status = 'running';
  job.error = undefined;
  await save(job, true);
  emit();
  try {
    if (!apiRef) throw new Error('Яндекс Диск не подключён');
    if (job.kind === 'download') await runDownload(job);
    else await runUpload(job);
    job.status = 'done';
    job.finishedAt = Date.now();
    if (!job.bytesTotal) job.bytesTotal = job.bytesDone;
  } catch (e) {
    job.status = 'error';
    job.error = (e as Error)?.message || 'Ошибка передачи';
    job.finishedAt = Date.now();
  } finally {
    active = null;
    await save(job, true);
    emit();
  }
}

async function fileMd5(path: string, size: number): Promise<string> {
  if (size > 150 * 1024 * 1024) return ''; // очень большие файлы проверяем по размеру
  try {
    const bytes = await readBytes(path);
    return SparkMD5.ArrayBuffer.hash(bytes.buffer as ArrayBuffer);
  } catch {
    return '';
  }
}

async function runDownload(job: TransferJob): Promise<void> {
  const api = apiRef!;
  const href = await api.downloadUrl(job.src);
  await mkdirp(parentLocal(job.dst));
  active = { id: job.id, url: href };
  await bindProgress();

  const attempt = async (): Promise<void> => {
    await FileTransfer.downloadFile({
      url: href,
      path: job.dst,
      progress: true,
      connectTimeout: 30_000,
      readTimeout: 300_000,
    });
    const st = await Filesystem.stat({ path: job.dst });
    if (!st.size) throw new Error('Скачался пустой файл');
    job.bytesDone = st.size;
    job.bytesTotal = st.size;
    if (job.md5Expected) {
      const md5 = await fileMd5(job.dst, st.size);
      if (md5 && md5 !== job.md5Expected) {
        throw Object.assign(new Error('Контрольная сумма не совпала'), { retryable: true });
      }
    }
  };

  try {
    await attempt();
  } catch (first) {
    if ((first as { retryable?: boolean }).retryable) {
      await deleteFile(job.dst).catch(() => {});
      active = { id: job.id, url: href };
      await attempt(); // вторая попытка; при повторной ошибке — статус error
    } else {
      await deleteFile(job.dst).catch(() => {});
      throw first;
    }
  }

  if (job.deleteAfter) {
    try {
      await api.delete(job.src);
      job.note = 'оригинал с Диска удалён после проверки';
    } catch (e) {
      job.note = `копия скачана, но оригинал не удалён: ${(e as Error)?.message}`;
    }
  }
}

async function runUpload(job: TransferJob): Promise<void> {
  const api = apiRef!;
  const mime = guessMime(job.name);
  const localSize = (await Filesystem.stat({ path: job.src })).size;
  job.bytesTotal = localSize;
  const md5 = await fileMd5(job.src, localSize);
  job.md5Local = md5 || undefined;
  await save(job, true);

  const href = await api.uploadUrl(job.dst, job.overwrite ?? false);
  active = { id: job.id, url: href };
  await bindProgress();

  const attempt = async (): Promise<void> => {
    const res = await FileTransfer.uploadFile({
      url: href,
      path: job.src,
      method: 'PUT',
      mimeType: mime,
      chunkedMode: false,
      headers: { 'Content-Type': mime },
      progress: true,
      connectTimeout: 30_000,
      readTimeout: 600_000,
    });
    const code = Number(res.responseCode);
    if (!(code >= 200 && code < 300)) {
      throw Object.assign(new Error(`Диск отклонил загрузку (${res.responseCode})`), { retryable: true });
    }
    job.bytesDone = localSize;
    if (md5) {
      const item = await api.resource(job.dst, false);
      if (item.md5 && item.md5 !== md5) {
        throw Object.assign(new Error('Контрольная сумма на Диске не совпала'), { retryable: true });
      }
    }
  };

  try {
    await attempt();
  } catch (first) {
    if ((first as { retryable?: boolean }).retryable && (first as Error).message !== job.error) {
      active = { id: job.id, url: href };
      await attempt();
    } else {
      throw first;
    }
  }

  if (job.deleteLocal) {
    try {
      await deleteFile(job.src);
      job.note = 'локальный файл удалён после проверки';
    } catch (e) {
      job.note = `файл загружен, но локальная копия не удалена: ${(e as Error)?.message}`;
    }
  }
}
