import { normalize } from './util';

type Transformers = typeof import('@huggingface/transformers');

export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
export const TRANSLATE_MODEL = 'Xenova/opus-mt-ru-en';
export const TRANSLATE_EN_RU_MODEL = 'Xenova/opus-mt-en-ru';
export const CAPTION_MODEL = 'Xenova/blip-image-captioning-base';

let lib: Transformers | null = null;

export async function getLib(): Promise<Transformers> {
  if (!lib) {
    lib = await import('@huggingface/transformers');
    lib.env.allowLocalModels = false;
    lib.env.allowRemoteModels = true;
    lib.env.useBrowserCache = true;
  }
  return lib;
}

export interface ModelStatus {
  pct: number;
  msg: string;
}

let statusHook: ((s: ModelStatus) => void) | null = null;

export function setModelStatus(cb: ((s: ModelStatus) => void) | null): void {
  statusHook = cb;
}

export function reporter(label: string) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (data: {
    status?: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (!data) return;
    if (data.status === 'progress' && data.file && data.total) {
      files.set(data.file, { loaded: data.loaded ?? 0, total: data.total });
      let loaded = 0;
      let total = 0;
      files.forEach((f) => {
        loaded += f.loaded;
        total += f.total;
      });
      const pct = total ? Math.round((loaded / total) * 100) : 0;
      statusHook?.({ pct, msg: `${label}: ${pct}%` });
    } else if (data.status === 'initiate' && data.file) {
      statusHook?.({ pct: 0, msg: `${label}: ${data.file}` });
    }
  };
}

interface ClipBundle {
  tokenizer: {
    (text: string[], opts?: object): Promise<Record<string, unknown>>;
  };
  processor: (image: unknown) => Promise<Record<string, unknown>>;
  text: (inputs: Record<string, unknown>) => Promise<{ text_embeds: { dims: number[]; data: Float32Array } }>;
  vision: (inputs: Record<string, unknown>) => Promise<{ image_embeds: { dims: number[]; data: Float32Array } }>;
}

let clip: ClipBundle | null = null;
let clipLoading: Promise<void> | null = null;
let translator: ((text: string, opts?: object) => Promise<unknown>) | null = null;
let translatorLoading: Promise<void> | null = null;

export function modelsLoaded(): boolean {
  return clip !== null;
}

async function loadVision(t: Transformers, cb: (d: never) => void): Promise<ClipBundle['vision']> {
  const hasGpu = typeof navigator !== 'undefined' && !!(navigator as { gpu?: unknown }).gpu;
  const attempts: { device: string; dtype: string }[] = hasGpu
    ? [
        { device: 'webgpu', dtype: 'fp16' },
        { device: 'wasm', dtype: 'q8' },
      ]
    : [{ device: 'wasm', dtype: 'q8' }];
  let lastErr: unknown;
  for (const opts of attempts) {
    try {
      statusHook?.({ pct: 0, msg: `Загрузка CLIP (${opts.device})…` });
      return (await t.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, {
        ...opts,
        progress_callback: cb,
      } as never)) as unknown as ClipBundle['vision'];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Не удалось загрузить vision-модель CLIP');
}

export async function preloadModels(): Promise<void> {
  if (clip) return;
  if (!clipLoading) {
    clipLoading = (async () => {
      const t = await getLib();
      statusHook?.({ pct: 0, msg: 'Загрузка CLIP…' });
      const tokenizer = (await t.AutoTokenizer.from_pretrained(CLIP_MODEL, {
        progress_callback: reporter('CLIP'),
      } as never)) as unknown as ClipBundle['tokenizer'];
      const processor = (await t.AutoProcessor.from_pretrained(CLIP_MODEL, {
        progress_callback: reporter('CLIP'),
      } as never)) as unknown as ClipBundle['processor'];
      const text = (await t.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, {
        dtype: 'q8',
        progress_callback: reporter('CLIP'),
      } as never)) as unknown as ClipBundle['text'];
      const vision = await loadVision(t, reporter('CLIP') as (d: never) => void);
      clip = { tokenizer, processor, text, vision };
      statusHook?.({ pct: 100, msg: 'CLIP готова' });
    })().catch((e) => {
      // Не кешируем ошибку: следующая попытка снова попробует загрузить модель
      // (например, после отключения WebGPU или восстановления сети).
      clipLoading = null;
      throw e;
    });
  }
  return clipLoading;
}

async function ensureTranslator(): Promise<void> {
  if (translator) return;
  if (!translatorLoading) {
    translatorLoading = (async () => {
      const t = await getLib();
      statusHook?.({ pct: 0, msg: 'Загрузка модели перевода…' });
      const pipe = await t.pipeline('translation', TRANSLATE_MODEL, {
        dtype: 'q8',
        progress_callback: reporter('Переводчик'),
      } as never);
      translator = pipe as unknown as (text: string, opts?: object) => Promise<unknown>;
      statusHook?.({ pct: 100, msg: 'Переводчик готов' });
    })().catch((e) => {
      translatorLoading = null;
      throw e;
    });
  }
  return translatorLoading;
}

export function hasCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text);
}

const COMMAND_WORDS =
  /^\s*(пожалуйста[,\s]+)?(найди|найдите|покажи|покажите|найти|ищи|искать|поиск|подбери|фотографии|фотографию|фотки|фото|снимки|снимок|изображения|изображение|картинки|картинку)(\s+|$)/i;

export function cleanQuery(text: string): string {
  let t = text.trim().replace(/\s+/g, ' ');
  for (let i = 0; i < 3; i++) {
    const next = t.replace(COMMAND_WORDS, '');
    if (next === t) break;
    t = next.trim();
  }
  return t || text.trim();
}

/** Переводит запрос на английский (CLIP обучен на английском). */
export async function toEnglish(text: string): Promise<string> {
  const cleaned = cleanQuery(text);
  if (!hasCyrillic(cleaned)) return cleaned;
  try {
    await ensureTranslator();
    const out = (await translator!(cleaned, { max_new_tokens: 96 })) as
      | { translation_text?: string }[]
      | { translation_text?: string };
    const txt = Array.isArray(out) ? out[0]?.translation_text : out?.translation_text;
    return (txt || cleaned).trim();
  } catch {
    return cleaned;
  }
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  await preloadModels();
  const c = clip!;
  const inputs = await c.tokenizer(texts, { padding: true, truncation: true });
  const out = await c.text(inputs);
  const { dims, data } = out.text_embeds;
  const n = dims[0];
  const d = dims[1];
  const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
  const res: Float32Array[] = [];
  for (let i = 0; i < n; i++) res.push(normalize(arr.slice(i * d, (i + 1) * d)));
  return res;
}

export async function embedImage(blob: Blob): Promise<Float32Array> {
  await preloadModels();
  const t = await getLib();
  const c = clip!;
  const image = await t.RawImage.fromBlob(blob);
  const inputs = await c.processor(image);
  const out = await c.vision(inputs);
  const data = out.image_embeds.data;
  const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
  return normalize(arr.slice(0));
}

/** Предзагрузка обеих моделей (CLIP + переводчик). */
export async function preloadAll(): Promise<void> {
  await preloadModels();
  try {
    await ensureTranslator();
  } catch {
    /* переводчик необязателен для английских запросов */
  }
}

// --- Подписи BLIP (переименование файлов по содержимому) ---

type CaptionPipe = (img: unknown, opts?: object) => Promise<{ generated_text?: string }[] | { generated_text?: string }>;

let captioner: CaptionPipe | null = null;
let captionerLoading: Promise<void> | null = null;

export async function preloadCaptioner(): Promise<void> {
  if (captioner) return;
  if (!captionerLoading) {
    captionerLoading = (async () => {
      const t = await getLib();
      statusHook?.({ pct: 0, msg: 'Загрузка модели подписей (BLIP)…' });
      const pipe = await t.pipeline('image-to-text', CAPTION_MODEL, {
        dtype: 'q8',
        progress_callback: reporter('Подписи'),
      } as never);
      captioner = pipe as unknown as CaptionPipe;
      statusHook?.({ pct: 100, msg: 'Модель подписей готова' });
    })().catch((e) => {
      captionerLoading = null;
      throw e;
    });
  }
  return captionerLoading;
}

/** Строит текстовую подпись для изображения (по-английски). */
export async function captionImage(blob: Blob): Promise<string> {
  await preloadCaptioner();
  const t = await getLib();
  const img = await t.RawImage.fromBlob(blob);
  const out = await captioner!(img, { max_new_tokens: 32 });
  const first = Array.isArray(out) ? out[0] : out;
  return (first?.generated_text ?? '').trim();
}

// --- Переводчик en→ru (для русских имён файлов) ---

let enRu: ((text: string, opts?: object) => Promise<unknown>) | null = null;
let enRuLoading: Promise<void> | null = null;

export async function toRussian(text: string): Promise<string> {
  const src = text.trim();
  if (!src) return src;
  try {
    if (!enRuLoading) {
      enRuLoading = (async () => {
        const t = await getLib();
        statusHook?.({ pct: 0, msg: 'Загрузка переводчика en→ru…' });
        const pipe = await t.pipeline('translation', TRANSLATE_EN_RU_MODEL, {
          dtype: 'q8',
          progress_callback: reporter('Переводчик en→ru'),
        } as never);
        enRu = pipe as unknown as (text: string, opts?: object) => Promise<unknown>;
        statusHook?.({ pct: 100, msg: 'Переводчик en→ru готов' });
      })().catch((e) => {
        enRuLoading = null;
        throw e;
      });
    }
    await enRuLoading;
    const out = (await enRu!(src, { max_new_tokens: 96 })) as
      | { translation_text?: string }[]
      | { translation_text?: string };
    const txt = Array.isArray(out) ? out[0]?.translation_text : out?.translation_text;
    return (txt || src).trim();
  } catch {
    return src; // без перевода — оставляем английский текст
  }
}
