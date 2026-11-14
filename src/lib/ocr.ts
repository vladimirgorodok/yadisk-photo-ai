import { createWorker, OEM, type Worker } from 'tesseract.js';

export interface OcrResult {
  text: string;
  /** Средняя уверенность Tesseract, 0–100. */
  confidence: number;
}

type Logger = (status: string, pct: number) => void;

let logCb: Logger | null = null;
let workerP: Promise<Worker> | null = null;

/**
 * Ленивая загрузка Tesseract (русский + английский). Ядро и словари
 * качаются один раз и кэшируются браузером/WebView; после первой загрузки
 * распознавание работает офлайн.
 */
export function getOcrWorker(onLog?: Logger): Promise<Worker> {
  if (onLog) logCb = onLog;
  if (!workerP) {
    workerP = createWorker('rus+eng', OEM.LSTM_ONLY, {
      logger: (m) => logCb?.(m.status || 'загрузка OCR…', Math.round((m.progress ?? 0) * 100)),
    }).catch((e) => {
      workerP = null; // сетевой сбой — даём шанс повторить
      throw e;
    });
  }
  return workerP;
}

/** Освобождает worker (вызывается при выходе из приложения — не обязательно). */
export async function disposeOcr(): Promise<void> {
  const p = workerP;
  workerP = null;
  if (p) {
    try {
      (await p).terminate();
    } catch {
      /* уже завершён */
    }
  }
}

/** Распознавание одной картинки (PNG/JPEG/WebP — всё, что умеет canvas). */
export async function ocrBlob(blob: Blob): Promise<OcrResult> {
  const w = await getOcrWorker();
  const { data } = await w.recognize(blob);
  return { text: data?.text ?? '', confidence: Number(data?.confidence ?? 0) };
}

/** Есть ли на картинке осмысленный текст (для фильтра «изображения с текстом»). */
export function hasText(raw: string, confidence: number): boolean {
  if (confidence < 30) return false;
  const words = raw.split(/\s+/).filter((w) => /[\p{L}\p{N}]{2,}/u.test(w));
  return words.length >= 2;
}

/**
 * Собирает OCR-вывод в одну строку для имени файла: строки с буквами,
 * без «мусора» из отдельных символов, в пределах 70 знаков.
 */
export function textForName(raw: string): string {
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/[^\p{L}\p{N} №\-./(),:+]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => /[\p{L}]{2,}/u.test(l));
  let t = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (t.length > 70) {
    t = t.slice(0, 70);
    const sp = t.lastIndexOf(' ');
    if (sp > 30) t = t.slice(0, sp);
  }
  return t;
}

/**
 * Готовит картинку под OCR: укладывает в 1600px по длинной стороне,
 * отдаёт JPEG. createImageBitmap бросает ошибку на неподдерживаемых
 * форматах (например, HEIC без декодера) — это и есть «не декодируется».
 */
export async function toOcrJpeg(blob: Blob, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas недоступен');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  if (!out) throw new Error('не удалось подготовить изображение');
  return out;
}
