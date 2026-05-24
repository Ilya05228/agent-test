/**
 * Lightweight BM25 scorer for tool search.
 *
 * Each "document" is a tool name + description string.
 * We tokenize by splitting on non-alphanumeric characters and lowercasing.
 */

const K1 = 1.5; // term frequency saturation
const B = 0.75;  // length normalization

export interface Bm25Doc {
  id: number;
  tokens: string[];
  length: number;
}

export class Bm25 {
  private docs: Bm25Doc[] = [];
  private docFreq = new Map<string, number>(); // term → doc count
  private avgdl = 0;

  /** Index a batch of (id, text) pairs. Call once, or call addDoc repeatedly. */
  index(docs: { id: number; text: string }[]): void {
    for (const d of docs) {
      this.addDoc(d.id, d.text);
    }
  }

  addDoc(id: number, text: string): void {
    const tokens = tokenize(text);
    const doc: Bm25Doc = { id, tokens, length: tokens.length };
    this.docs.push(doc);

    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      }
    }
    this.avgdl =
      this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length;
  }

  /** Returns scored doc ids, sorted descending by score. 0-score omitted. */
  search(query: string): { id: number; score: number }[] {
    const qt = tokenize(query);
    if (qt.length === 0 || this.docs.length === 0) return [];

    const N = this.docs.length;
    const scores: { id: number; score: number }[] = [];

    for (const doc of this.docs) {
      const tf = termFreqs(doc.tokens);
      let score = 0;
      for (const t of qt) {
        const n = this.docFreq.get(t) ?? 0;
        if (n === 0) continue;
        const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
        const f = tf.get(t) ?? 0;
        score +=
          (idf * f * (K1 + 1)) /
          (f + K1 * (1 - B + B * (doc.length / this.avgdl)));
      }
      if (score > 0) scores.push({ id: doc.id, score });
    }
    return scores.sort((a, b) => b.score - a.score);
  }

  /** Clear all indexed documents */
  clear(): void {
    this.docs = [];
    this.docFreq.clear();
    this.avgdl = 0;
  }
}

/** Tokenize text: split on non-alpha (preserving digits), lowercase, drop empties */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter(Boolean);
}

/** Count term frequencies in a token list */
function termFreqs(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}
