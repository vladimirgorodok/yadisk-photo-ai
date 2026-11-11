export interface FaceInfo {
  /** Нормализованные координаты [x, y, w, h] относительно изображения (0..1). */
  box: [number, number, number, number];
  /** 128-мерный дескриптор лица (face-api). */
  desc: number[];
  /** Миниатюра лица в dataURL (для галереи групп). */
  thumb?: string;
  /** Оценка детектора. */
  score?: number;
}

export interface PhotoRec {
  path: string;
  name: string;
  dir: string;
  size: number;
  modified: string;
  md5: string;
  mime: string;
  /** Последняя подписанная ссылка на превью (может устареть). */
  preview?: string;
  /** CLIP-эмбеддинг (нормализованный, 512). */
  emb?: Float32Array;
  embModel?: string;
  embAt?: number;
  /** Проход детекции лиц выполнен. */
  facesDone?: boolean;
  facesModel?: string;
  faces?: FaceInfo[];
  /** Индекс категории (см. CATEGORIES). */
  cat?: number;
}

export interface IndexMeta {
  scanAt: number;
  count: number;
  modelKey: string;
}

export interface SearchHit {
  rec: PhotoRec;
  score: number;
  preview?: string;
}

export interface SelectedFile {
  path: string;
  name: string;
  preview?: string;
}

export interface Progress {
  label: string;
  done: number;
  total: number;
  detail?: string;
}

export interface FaceGroup {
  id: string;
  label: string;
  members: { path: string; name: string; thumb?: string; box: [number, number, number, number] }[];
  cover?: string;
}

export interface ThemeGroup {
  id: string;
  label: string;
  paths: string[];
  covers: string[];
  count: number;
}
