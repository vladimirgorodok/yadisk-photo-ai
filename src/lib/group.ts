import type { FaceGroup, PhotoRec, Progress, ThemeGroup } from '../types';
import { YandexDisk } from './api';
import { photoSet } from './db';
import { embedTexts } from './ai';
import { detectFaces, FACE_MODEL, toCanvas } from './faces';
import { previewBlob, previewCache } from './scan';
import { abortError } from './util';

export interface Category {
  label: string;
  prompt: string;
}

export const CATEGORIES: Category[] = [
  { label: 'Люди и портреты', prompt: 'a photo of people, a portrait or a selfie' },
  { label: 'Собаки', prompt: 'a photo of a dog' },
  { label: 'Кошки', prompt: 'a photo of a cat' },
  { label: 'Птицы', prompt: 'a photo of a bird' },
  { label: 'Другие животные', prompt: 'a photo of a wild animal or an exotic animal' },
  { label: 'Природа и пейзажи', prompt: 'a photo of nature, landscape, forest or mountains' },
  { label: 'Море и пляж', prompt: 'a photo of the sea, beach or ocean' },
  { label: 'Еда и напитки', prompt: 'a photo of food or drinks' },
  { label: 'Автомобили и транспорт', prompt: 'a photo of a car, motorcycle or vehicle' },
  { label: 'Город и архитектура', prompt: 'a photo of a city, street or building' },
  { label: 'Цветы и растения', prompt: 'a photo of flowers or plants' },
  { label: 'Документы и скриншоты', prompt: 'a screenshot, a document or text on a screen' },
  { label: 'Спорт и активность', prompt: 'a photo of sports, fitness or outdoor activity' },
  { label: 'Праздники и вечеринки', prompt: 'a photo of a party, celebration or holiday' },
];

export const OTHER_LABEL = 'Разное';

export type FaceGroupView = FaceGroup;

/** Проход детекции лиц по фотографиям. */
export async function runFacePass(
  api: YandexDisk,
  photos: PhotoRec[],
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<{ processed: number; faces: number; failed: number }> {
  const todo = photos.filter((p) => !p.facesDone || p.facesModel !== FACE_MODEL);
  let faces = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    if (signal.aborted) throw abortError();
    const rec = todo[i];
    onProgress({
      label: 'Агент ищет лица',
      done: i,
      total: todo.length,
      detail: rec.name,
    });
    try {
      const blob = await previewBlob(api, rec.path);
      const canvas = await toCanvas(blob, 640);
      rec.faces = await detectFaces(canvas);
      rec.facesDone = true;
      rec.facesModel = FACE_MODEL;
      faces += rec.faces.length;
      await photoSet(rec);
    } catch (e) {
      failed++;
      if (failed === 1) console.warn('Детекция лиц не удалась', rec.path, e);
    }
  }
  onProgress({
    label: 'Агент ищет лица',
    done: todo.length,
    total: todo.length,
    detail: `Найдено лиц: ${faces}`,
  });
  return { processed: todo.length, faces, failed };
}

interface Cluster {
  sum: number[];
  count: number;
  members: { path: string; name: string; thumb?: string; box: [number, number, number, number] }[];
}

function cosineToSum(desc: number[], sum: number[]): number {
  let dot = 0;
  let norm = 0;
  const len = Math.min(desc.length, sum.length);
  for (let i = 0; i < len; i++) {
    dot += desc[i] * sum[i];
    norm += sum[i] * sum[i];
  }
  return norm > 0 ? dot / Math.sqrt(norm) : 0;
}

/** Кластеризация лиц по 128-мерным дескрипторам. */
export function clusterFaces(photos: PhotoRec[], threshold = 0.5): FaceGroupView[] {
  const clusters: Cluster[] = [];
  for (const rec of photos) {
    if (!rec.faces?.length) continue;
    for (const face of rec.faces) {
      if (!face.desc || face.desc.length < 64) continue;
      let bestIdx = -1;
      let bestSim = -Infinity;
      for (let c = 0; c < clusters.length; c++) {
        const sim = cosineToSum(face.desc, clusters[c].sum);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = c;
        }
      }
      if (bestIdx >= 0 && bestSim >= threshold) {
        const cl = clusters[bestIdx];
        for (let i = 0; i < cl.sum.length; i++) cl.sum[i] += face.desc[i];
        cl.count++;
        cl.members.push({ path: rec.path, name: rec.name, thumb: face.thumb, box: face.box });
      } else {
        clusters.push({
          sum: [...face.desc],
          count: 1,
          members: [{ path: rec.path, name: rec.name, thumb: face.thumb, box: face.box }],
        });
      }
    }
  }
  return clusters
    .filter((c) => c.members.length >= 2)
    .sort((a, b) => b.members.length - a.members.length)
    .map((c, i) => ({
      id: `face-${i + 1}`,
      label: `Человек ${i + 1}`,
      members: c.members,
      cover: c.members[0]?.thumb,
    }));
}

/** Тематические группы через CLIP (животные, природа, еда и т.д.). */
export async function computeThemes(
  photos: PhotoRec[],
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<ThemeGroup[]> {
  const withEmb = photos.filter((p) => p.emb && p.emb.length > 0);
  if (!withEmb.length) return [];
  onProgress({ label: 'Агент группирует сюжеты', done: 0, total: withEmb.length + 1 });
  const catEmb = await embedTexts(CATEGORIES.map((c) => c.prompt));
  if (signal.aborted) throw abortError();

  const groups: PhotoRec[][] = CATEGORIES.map(() => []);
  const other: PhotoRec[] = [];
  const changed: PhotoRec[] = [];
  for (let i = 0; i < withEmb.length; i++) {
    if (signal.aborted) throw abortError();
    const rec = withEmb[i];
    const emb = rec.emb!;
    let best = -1;
    let bestScore = -Infinity;
    for (let c = 0; c < catEmb.length; c++) {
      const e = catEmb[c];
      let s = 0;
      for (let k = 0; k < e.length; k++) s += emb[k] * e[k];
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    const cat = bestScore >= 0.19 ? best : -1;
    if (rec.cat !== cat) {
      rec.cat = cat;
      changed.push(rec);
    }
    if (cat >= 0) groups[cat].push(rec);
    else other.push(rec);
    if (i % 25 === 0) {
      onProgress({ label: 'Агент группирует сюжеты', done: i, total: withEmb.length + 1 });
    }
  }
  for (let i = 0; i < changed.length; i += 40) {
    await Promise.all(changed.slice(i, i + 40).map((r) => photoSet(r)));
  }
  for (const rec of withEmb) {
    if (!rec.emb) continue;
    if (!rec.embModel) {
      rec.embModel = 'clip-vit-b32';
      await photoSet(rec);
    }
  }

  const themes: ThemeGroup[] = [];
  const coverFor = (r: PhotoRec): string | undefined => previewCache.get(r.path) ?? r.preview;
  groups.forEach((recs, idx) => {
    if (!recs.length) return;
    themes.push({
      id: `theme-${idx}`,
      label: CATEGORIES[idx].label,
      paths: recs.map((r) => r.path),
      covers: recs.slice(0, 4).map(coverFor).filter((x): x is string => !!x),
      count: recs.length,
    });
  });
  themes.sort((a, b) => b.count - a.count);
  if (other.length >= 2) {
    themes.push({
      id: 'theme-other',
      label: OTHER_LABEL,
      paths: other.map((r) => r.path),
      covers: other.slice(0, 4).map(coverFor).filter((x): x is string => !!x),
      count: other.length,
    });
  }
  onProgress({ label: 'Агент группирует сюжеты', done: withEmb.length + 1, total: withEmb.length + 1 });
  return themes;
}
