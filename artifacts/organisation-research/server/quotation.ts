interface QuotationPass {
  text: string;
  /** Normalised boundary offset → original UTF-16 offset. */
  starts: Map<number, number>;
  /** Normalised boundary offset → original UTF-16 offset. */
  ends: Map<number, number>;
}

export interface QuotationIndex {
  sourceText: string;
  normalised: QuotationPass;
  folded: QuotationPass;
}

const segmenter = new Intl.Segmenter("en-GB", { granularity: "grapheme" });

const punctuation = (value: string) =>
  value
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...");

const caseFold = (value: string) =>
  value.toLowerCase().replace(/\u00df/g, "ss");

function append(
  pass: QuotationPass,
  value: string,
  start: number,
  end: number,
) {
  if (/^\s+$/u.test(value)) {
    if (!pass.text || pass.text.endsWith(" ")) {
      if (pass.text.endsWith(" ")) pass.ends.set(pass.text.length, end);
      return;
    }
    value = " ";
  }
  const offset = pass.text.length;
  pass.starts.set(offset, start);
  pass.text += value;
  pass.ends.set(pass.text.length, end);
}

function finish(pass: QuotationPass) {
  if (!pass.text.endsWith(" ")) return;
  const endOffset = pass.text.length;
  pass.text = pass.text.slice(0, -1);
  pass.ends.delete(endOffset);
}

/**
 * Build both searchable forms and their original-text boundary maps once.
 * Grapheme segmentation lets NFKC compose combining sequences while ensuring
 * a match cannot start or finish inside one original grapheme's expansion.
 */
export function buildQuotationIndex(sourceText: string): QuotationIndex {
  const normalised: QuotationPass = {
    text: "",
    starts: new Map(),
    ends: new Map(),
  };
  const folded: QuotationPass = {
    text: "",
    starts: new Map(),
    ends: new Map(),
  };
  for (const segment of segmenter.segment(sourceText)) {
    const value = punctuation(segment.segment.normalize("NFKC"));
    const start = segment.index;
    const end = start + segment.segment.length;
    append(normalised, value, start, end);
    append(folded, caseFold(value), start, end);
  }
  finish(normalised);
  finish(folded);
  return { sourceText, normalised, folded };
}

function locateInPass(
  index: QuotationIndex,
  pass: QuotationPass,
  wanted: string,
  folded: boolean,
): string | null {
  if (!wanted) return null;
  let position = pass.text.indexOf(wanted);
  while (position >= 0) {
    const endPosition = position + wanted.length;
    const start = pass.starts.get(position);
    const end = pass.ends.get(endPosition);
    if (start !== undefined && end !== undefined) {
      const original = index.sourceText.slice(start, end);
      const checked = buildQuotationIndex(original);
      const checkedText = folded
        ? checked.folded.text
        : checked.normalised.text;
      if (checkedText === wanted) return original;
    }
    position = pass.text.indexOf(wanted, position + 1);
  }
  return null;
}

/**
 * Locate a quotation despite presentational Unicode, punctuation, whitespace
 * and case differences, returning the exact matching span from the source.
 */
export function locateQuotation(
  source: QuotationIndex | string,
  quote: string,
): string | null {
  const index =
    typeof source === "string" ? buildQuotationIndex(source) : source;
  const wanted = buildQuotationIndex(quote);
  return (
    locateInPass(index, index.normalised, wanted.normalised.text, false) ??
    locateInPass(index, index.folded, wanted.folded.text, true)
  );
}