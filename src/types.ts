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
  /** Источник: файл с Яндекс Диска или локальный файл устройства. */
  source?: 'disk' | 'local';
  /** Последняя подписанная ссылка на превью (может устареть). */
  preview?: string;
  /** Локальная миниатюра (для файлов устройства). */
  thumb?: Blob;
  /** Время изменения в мс (для локальных файлов). */
  mtime?: number;
  /** CLIP-эмбеддинг (нормализованный, 512). */
  emb?: Float32Array;
  embModel?: string;
  embAt?: number;
  /** Подпись BLIP (для переименования по содержимому). */
  caption?: string;
  captionAt?: number;
  /** Проход детекции лиц выполнен. */
  facesDone?: boolean;
  facesModel?: string;
  faces?: FaceInfo[];
  /** Индекс категории (см. CATEGORIES). */
  cat?: number;
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'canceled';

/** Задача очереди «Трансфер» (копирование между Диском и устройством). */
export interface TransferJob {
  id: string;
  kind: 'download' | 'upload';
  /** Источник: путь на Диске (download) или локальный путь (upload). */
  src: string;
  /** Назначение: локальный путь (download) или путь на Диске (upload). */
  dst: string;
  name: string;
  status: JobStatus;
  bytesDone: number;
  bytesTotal: number;
  error?: string;
  /** Примечание (например, «пропущен: уже есть»). */
  note?: string;
  /** download: удалить оригинал с Диска после успешной проверки md5. */
  deleteAfter?: boolean;
  /** upload: удалить локальный файл после успешной проверки md5. */
  deleteLocal?: boolean;
  /** Ожидаемый md5 (с Диска) для проверки после скачивания. */
  md5Expected?: string;
  /** Ожидаемый md5 (локальный) для проверки после загрузки. */
  md5Local?: string;
  /** Загрузка с разрешением перезаписи (политика «заменять»). */
  overwrite?: boolean;
  createdAt: number;
  finishedAt?: number;
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
