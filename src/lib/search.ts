import { embedTexts, toEnglish } from './ai';
import { dot } from './util';
import { previewCache } from './scan';
import type { PhotoRec, SearchHit } from '../types';

/**
 * Оценивает список фото по текстовому запросу (переводит на английский,
 * считает CLIP-эмбеддинг запроса и ранжирует по косинусной близости).
 */
export async function scoreQuery(
  recs: PhotoRec[],
  query: string,
): Promise<{ hits: SearchHit[]; translated: string | null }> {
  const en = await toEnglish(query);
  const [qemb] = await embedTexts([en]);
  const hits: SearchHit[] = recs
    .filter((p) => p.emb && p.emb.length === qemb.length)
    .map((rec) => ({
      rec,
      score: dot(rec.emb!, qemb),
      preview: rec.thumb ? undefined : (previewCache.get(rec.path) ?? rec.preview),
    }));
  hits.sort((a, b) => b.score - a.score);
  const translated =
    en && en.toLowerCase() !== query.toLowerCase() && /[Ѐ-ӿ]/.test(query) ? en : null;
  return { hits, translated };
}
