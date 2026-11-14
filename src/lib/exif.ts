import exifr from 'exifr';

/**
 * Настоящая дата создания снимка из EXIF: DateTimeOriginal (дата съёмки),
 * затем CreateDate. Не зависит от копирований и переименований — именно то,
 * что нужно для имени файла вида «Текст ДД.ММ.ГГ».
 * Возвращает undefined, если EXIF нет (скриншоты, документы) — тогда
 * вызывающий код берёт mtime файла (на переименование не влияет).
 */
export async function exifDate(blob: Blob): Promise<number | undefined> {
  try {
    const r = (await exifr.parse(blob, ['DateTimeOriginal', 'CreateDate'])) as
      | { DateTimeOriginal?: unknown; CreateDate?: unknown }
      | undefined;
    const v = r?.DateTimeOriginal ?? r?.CreateDate;
    const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  } catch {
    return undefined;
  }
}
