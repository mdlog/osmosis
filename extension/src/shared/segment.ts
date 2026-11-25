/** A sentence with its character span inside the paragraph's textContent. */
export interface Span {
  text: string;
  start: number;
  end: number;
}

/**
 * Split English paragraph text into sentences, keeping offsets so the DOM can be
 * wrapped sentence by sentence. Leading/trailing whitespace is excluded from each span.
 */
export function splitSentences(text: string): Span[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const out: Span[] = [];
  for (const s of seg.segment(text)) {
    const raw = s.segment;
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = s.index + lead;
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return mergeAbbreviations(out, text);
}

const ABBREV = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K|No)\.$/i;

/** Intl.Segmenter splits after common abbreviations ("Dr. Smith"); glue those back. */
function mergeAbbreviations(spans: Span[], text: string): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && ABBREV.test(prev.text)) {
      prev.end = s.end;
      prev.text = text.slice(prev.start, prev.end);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Heuristic: is this sentence worth translating (has enough real words)? */
export function isTranslatable(s: string): boolean {
  const words = s.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  return words.length >= 4 && s.length <= 400;
}
