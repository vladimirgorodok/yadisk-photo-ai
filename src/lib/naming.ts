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

/* ---------- Маски переименования (настраиваются в «Настройках») ---------- */

/** ДД.ММ.ГГ — формат даты из задания для имён файлов. */
export function dateShort(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}.${mm}.${yy}`;
}

/** ГГГГ-ММ-ДД — запасной формат ({dateiso}). */
export function dateIso(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** ЧЧ.ММ — время ({time}). */
export function timeShort(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Текст для имени: чистит запрещённые символы, но сохраняет пробелы и регистр. */
export function sanitizeText(text: string): string {
  return cleanCaption(text)
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function limitName(t: string): string {
  let s = t;
  if (s.length > 70) {
    s = s.slice(0, 70);
    const sp = s.lastIndexOf(' ');
    if (sp > 30) s = s.slice(0, sp);
  }
  return s.replace(/[. ]+$/g, '');
}

/**
 * Имя файла по маске. Подставляет: {text} — найденный/подписанный текст,
 * {date} — ДД.ММ.ГГ, {dateiso} — ГГГГ-ММ-ДД, {time} — ЧЧ.ММ, {name} — старое имя.
 * Примеры: «{text} {date}» → `Договор 14.11.26.jpg`, «{date} {text}» → `14.11.26 кот на диване.jpg`.
 */
export function nameFromMask(
  mask: string,
  opts: { text: string; dateMs?: number; origName?: string; ext: string },
): string {
  const ext = opts.ext.startsWith('.') ? opts.ext : opts.ext ? `.${opts.ext}` : '';
  const text = sanitizeText(opts.text) || sanitizeText(opts.origName || '') || 'без имени';
  const vars: Record<string, string> = {
    text,
    date: dateShort(opts.dateMs),
    dateiso: dateIso(opts.dateMs),
    time: timeShort(opts.dateMs),
    name: sanitizeText(opts.origName || ''),
  };
  const raw = (mask || '{text} {date}').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? '');
  const base = limitName(sanitizeText(raw)) || 'без имени';
  return base + ext;
}
