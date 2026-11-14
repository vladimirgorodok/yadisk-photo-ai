/** Общий тип элемента списка-ревью функций переименования. */
export type ReviewState = 'wait' | 'busy' | 'ready' | 'skip' | 'failed' | 'renamed';

export interface ReviewItem {
  path: string;
  name: string;
  /** Подпись ИИ или распознанный текст (показывается под именем). */
  caption?: string;
  /** Настоящая дата файла (EXIF → mtime) для подстановки в маску. */
  date?: number;
  /** Имя, предложенное по маске (редактируется пользователем). */
  proposed: string;
  checked: boolean;
  state: ReviewState;
  /** Детали состояния busy/skip. */
  note?: string;
  error?: string;
}
