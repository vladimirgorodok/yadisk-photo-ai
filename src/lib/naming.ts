/** Генерация имени файла по подписи изображения (чистые функции, без зависимостей). */

const ILLEGAL = /[\\/:*?"<>|#%&{}$!@+`~^[\]();,'"]/g;

/** Убирает «шум» подписи: вводные фразы, точки, лишние пробелы. */
export function cleanCaption(caption: string): string {
  return caption
    .trim()
    .replace(/^a (photo|picture|image|snapshot) (of|showing|with)\s+/i, '')
    .replace(/^(фото|снимок|изображение)\s+/i, '')
    .replace(/[.!?…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Превращает подпись в «слаг»: без запрещённых символов, пробелы → _. */
export function sanitizeSlug(text: string): string {
  let t = cleanCaption(text)
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (t.length > 60) {
    t = t.slice(0, 60);
    const sp = t.lastIndexOf(' ');
    if (sp > 24) t = t.slice(0, sp);
  }
  t = t.replace(/\s/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return t || 'без_имени';
}

function datePrefix(mtime?: number): string {
  if (!mtime) return '';
  const d = new Date(mtime);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}_`;
}

/**
 * Итоговое имя: `2024-05-12_кот_на_диване.jpg`.
 * @param caption подпись (уже переведённая на русский, если удалось)
 * @param mtime время изменения файла в мс
 * @param ext расширение с точкой (`.jpg`)
 */
export function suggestFileName(caption: string, mtime: number | undefined, ext: string): string {
  const e = ext.startsWith('.') ? ext : ext ? `.${ext}` : '';
  return `${datePrefix(mtime)}${sanitizeSlug(caption)}${e}`;
}

/** Подбирает свободное имя: `имя (1).jpg`, `имя (2).jpg`… */
export function conflictLocalName(name: string, attempt: number): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${base} (${attempt})${ext}`;
}
