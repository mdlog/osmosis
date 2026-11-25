export type Lang = 'es' | 'fr' | 'de' | 'ja';
export type Level = 'A1' | 'A2' | 'B1' | 'B2';

export const LANG_NAME: Record<Lang, string> = {
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
};

/** One target-language word the model used in a translated sentence. */
export interface Word {
  /** Surface form exactly as it appears in the translated sentence. */
  w: string;
  /** Dictionary form, used as the key of the learner's vocabulary. */
  lemma: string;
  /** Short English meaning. */
  en: string;
}

/** A translated sentence, as returned by the model (after validation). */
export interface Item {
  /** 1-based index into the sentences that were sent. */
  i: number;
  text: string;
  words: Word[];
}

export type InferenceSource = 'on_device' | 'in_cloud';

export interface TranslateRequest {
  type: 'osm:translate';
  /** Paragraph id, unique per page. */
  pid: string;
  sentences: string[];
  lang: Lang;
  level: Level;
}

export interface TranslateResponse {
  pid: string;
  /** Index-aligned with the request sentences; null = keep the English sentence. */
  items: (Item | null)[];
  source: InferenceSource | 'none';
  ms: number;
  /** Served entirely from the local translation cache. */
  cached?: boolean;
  error?: string;
}
