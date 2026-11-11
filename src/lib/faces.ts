import type * as FaceApiNS from '@vladmandic/face-api';
import type { FaceInfo } from '../types';

export const FACE_MODEL = 'face-api-1';

let faceapi: typeof FaceApiNS | null = null;
let loading: Promise<typeof FaceApiNS> | null = null;

function modelsUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.replace(/\/+$/, '')}/models/face`;
}

export async function ensureFaceApi(): Promise<typeof FaceApiNS> {
  if (faceapi) return faceapi;
  if (!loading) {
    loading = (async () => {
      const mod = (await import('@vladmandic/face-api')) as typeof FaceApiNS;
      const backend = mod.tf as unknown as { ready?: () => Promise<void> };
      if (backend.ready) await backend.ready();
      const url = modelsUrl();
      await Promise.all([
        mod.nets.tinyFaceDetector.loadFromUri(url),
        mod.nets.faceLandmark68Net.loadFromUri(url),
        mod.nets.faceRecognitionNet.loadFromUri(url),
      ]);
      faceapi = mod;
      return mod;
    })();
  }
  return loading;
}

export function faceApiReady(): boolean {
  return faceapi !== null;
}

/** Рисует изображение в canvas с ограничением по стороне (для детекции). */
export async function toCanvas(blob: Blob, maxSide = 640): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas;
}

function faceThumb(canvas: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }): string | undefined {
  try {
    const pad = 0.28;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const side = Math.max(box.width, box.height) * (1 + pad * 2);
    let x = cx - side / 2;
    let y = cy - side / 2;
    x = Math.max(0, Math.min(canvas.width - side, x));
    y = Math.max(0, Math.min(canvas.height - side, y));
    const s = Math.min(side, canvas.width - x, canvas.height - y);
    if (s <= 2) return undefined;
    const out = document.createElement('canvas');
    out.width = 144;
    out.height = 144;
    const ctx = out.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(canvas, x, y, s, s, 0, 0, 144, 144);
    return out.toDataURL('image/jpeg', 0.82);
  } catch {
    return undefined;
  }
}

export async function detectFaces(canvas: HTMLCanvasElement): Promise<FaceInfo[]> {
  const mod = await ensureFaceApi();
  const opts = new mod.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.45 });
  const results = await mod.detectAllFaces(canvas, opts).withFaceLandmarks().withFaceDescriptors();
  const w = canvas.width;
  const h = canvas.height;
  return results.map((r) => {
    const b = r.detection.box;
    return {
      box: [
        Math.max(0, b.x / w),
        Math.max(0, b.y / h),
        Math.min(1, b.width / w),
        Math.min(1, b.height / h),
      ],
      desc: Array.from(r.descriptor),
      thumb: faceThumb(canvas, b),
      score: r.detection.score,
    };
  });
}

export function cosine(a: number[] | Float32Array, b: number[] | Float32Array): number {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}
