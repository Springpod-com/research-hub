/**
 * Deterministic occupation matching over the bundled official datasets.
 *
 * Candidate matches are produced by weighted keyword retrieval (BM25-style)
 * over each occupation's title, alternate/index titles, description and task
 * statements. The terms that produced a match are returned so the researcher
 * sees exactly why an occupation was suggested; there is no model involved and
 * no unexplained confidence score. A match only becomes part of a role when a
 * researcher records it, and it is stored as "proposed" until confirmed.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  DatasetSummary,
  OccupationCandidate,
  OccupationDataset,
  OccupationEntry,
  OccupationScheme,
} from "../shared/occupations.js";
import type { Occupation, Role } from "../shared/types.js";
import { HttpError, hydrateDatasetMatch } from "./domain.js";

const DATA_DIR =
  process.env.OCCUPATION_DATA_DIR ||
  path.resolve(import.meta.dirname, "../data/occupations");
const FILES: Record<OccupationScheme, string> = {
  "UK SOC": "uk-soc-2020.json",
  "O*NET": "onet.json",
};
type Field = "title" | "altTitles" | "description" | "tasks";
const FIELDS: Field[] = ["title", "altTitles", "description", "tasks"];
const FIELD_WEIGHT: Record<Field, number> = {
  title: 6,
  altTitles: 3,
  description: 1.2,
  tasks: 1,
};
const STOP = new Set(
  "the and for with from that this into onto our your their they them who what when where which will would can could should must may might also all any are was were been being has have had into over under about across after before between during than then there these those where while within without you not but nor per via our own such other more most less least very just only both each same into out off on in at by to of as an or is it be do so if we us".split(
    " ",
  ),
);
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t))
    .map((t) =>
      t.endsWith("ies") && t.length > 4
        ? t.slice(0, -3) + "y"
        : t.endsWith("sses")
          ? t.slice(0, -2)
          : t.endsWith("s") && !t.endsWith("ss") && t.length > 3
            ? t.slice(0, -1)
            : t,
    );
}
interface Doc {
  entry: OccupationEntry;
  tf: Record<Field, Map<string, number>>;
  len: Record<Field, number>;
  titleKey: string;
  altKeys: string[];
}
interface Index {
  dataset: OccupationDataset;
  docs: Doc[];
  df: Record<Field, Map<string, number>>;
  avgLen: Record<Field, number>;
}
const normalise = (s: string) => tokens(s).join(" ");
function fieldText(e: OccupationEntry, f: Field): string {
  if (f === "title") return e.title;
  if (f === "altTitles") return e.altTitles.join(" \n ");
  if (f === "description") return e.description;
  return [...e.tasks, ...e.activities].join(" \n ");
}
function buildIndex(dataset: OccupationDataset): Index {
  const df: Record<Field, Map<string, number>> = {
    title: new Map(),
    altTitles: new Map(),
    description: new Map(),
    tasks: new Map(),
  };
  const total: Record<Field, number> = {
    title: 0,
    altTitles: 0,
    description: 0,
    tasks: 0,
  };
  const docs = dataset.entries.map((entry): Doc => {
    const tf = {} as Doc["tf"];
    const len = {} as Doc["len"];
    for (const f of FIELDS) {
      const ts = tokens(fieldText(entry, f));
      const m = new Map<string, number>();
      for (const t of ts) m.set(t, (m.get(t) || 0) + 1);
      for (const t of m.keys()) df[f].set(t, (df[f].get(t) || 0) + 1);
      tf[f] = m;
      len[f] = ts.length;
      total[f] += ts.length;
    }
    return {
      entry,
      tf,
      len,
      titleKey: normalise(entry.title),
      altKeys: entry.altTitles.map(normalise),
    };
  });
  const avgLen = {} as Record<Field, number>;
  for (const f of FIELDS) avgLen[f] = total[f] / Math.max(1, docs.length);
  return { dataset, docs, df, avgLen };
}
const indexes = new Map<OccupationScheme, Promise<Index>>();
export function loadIndex(scheme: OccupationScheme): Promise<Index> {
  let p = indexes.get(scheme);
  if (!p) {
    p = readFile(path.join(DATA_DIR, FILES[scheme]), "utf8")
      .then((raw) => buildIndex(JSON.parse(raw) as OccupationDataset))
      .catch((err) => {
        indexes.delete(scheme);
        throw new HttpError(
          503,
          `The ${scheme} reference dataset is not available on this server (${err instanceof Error ? err.message : String(err)}). Run the occupations import.`,
        );
      });
    indexes.set(scheme, p);
  }
  return p;
}
export const schemes: OccupationScheme[] = ["UK SOC", "O*NET"];
export async function datasetSummaries(): Promise<DatasetSummary[]> {
  const out: DatasetSummary[] = [];
  for (const scheme of schemes) {
    const { dataset } = await loadIndex(scheme);
    const { entries, entryUrl, ...rest } = dataset;
    void entryUrl;
    out.push({ ...rest, occupations: entries.length });
  }
  return out;
}
export const entryUrl = (dataset: OccupationDataset, code: string) =>
  dataset.entryUrl.replace("{code}", encodeURIComponent(code));
export async function getEntry(scheme: OccupationScheme, code: string) {
  const { dataset, docs } = await loadIndex(scheme);
  const doc = docs.find((d) => d.entry.code === code);
  if (!doc)
    throw new HttpError(404, "Occupation code not found in the dataset.");
  const { entries, ...meta } = dataset;
  void entries;
  return {
    dataset: { ...meta, occupations: entries.length } as DatasetSummary,
    sourceUrl: entryUrl(dataset, code),
    entry: doc.entry,
  };
}
export interface Query {
  /** Job title terms; weighted highest. */
  title: string;
  /** Free text such as responsibilities; weighted lower. */
  context?: string;
  seniority?: string;
}
const K1 = 1.4;
const B = 0.6;
export async function search(
  scheme: OccupationScheme,
  query: Query,
  limit = 6,
): Promise<OccupationCandidate[]> {
  const index = await loadIndex(scheme);
  const weights = new Map<string, number>();
  const add = (text: string | undefined, w: number, cap: number) => {
    const seen = new Map<string, number>();
    for (const t of tokens(text || "")) seen.set(t, (seen.get(t) || 0) + 1);
    // Frequent context terms matter a little more, but a wall of text must not
    // drown the job title.
    [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .forEach(([t]) => weights.set(t, Math.max(weights.get(t) || 0, w)));
  };
  add(query.context, 1, 40);
  add(query.seniority, 1.5, 6);
  add(query.title, 3, 12);
  if (!weights.size) return [];
  const titleKey = normalise(query.title);
  const titleTerms = new Set(tokens(query.title));
  const N = index.docs.length;
  const scored = index.docs.map((doc) => {
    let score = 0;
    const matched: Record<Field, string[]> = {
      title: [],
      altTitles: [],
      description: [],
      tasks: [],
    };
    for (const [term, qw] of weights) {
      for (const f of FIELDS) {
        const tf = doc.tf[f].get(term);
        if (!tf) continue;
        const df = index.df[f].get(term) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const norm =
          tf / (tf + K1 * (1 - B + (B * doc.len[f]) / index.avgLen[f]));
        score += FIELD_WEIGHT[f] * idf * norm * qw;
        matched[f].push(term);
      }
    }
    // Whole-title agreement outranks scattered keyword hits: a role title that
    // is literally one of the dataset's titles is the strongest signal.
    if (titleKey && score > 0) {
      if (doc.titleKey === titleKey) score *= 1.5;
      else if (doc.altKeys.includes(titleKey)) score *= 1.35;
      else if (
        doc.titleKey.includes(titleKey) ||
        doc.altKeys.some((k) => k.includes(titleKey))
      )
        score *= 1.15;
    }
    return { doc, score, matched };
  });
  const dataset = index.dataset;
  return scored
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.doc.entry.code.localeCompare(b.doc.entry.code),
    )
    .slice(0, limit)
    .map(({ doc, score, matched }) => {
      const matchedTitles = doc.entry.altTitles
        .filter((t) => tokens(t).some((x) => titleTerms.has(x)))
        .slice(0, 4);
      const matchedTerms = FIELDS.filter((f) => matched[f].length).map((f) => ({
        field: f,
        terms: [...new Set(matched[f])],
      }));
      return {
        scheme,
        jurisdiction: dataset.jurisdiction,
        code: doc.entry.code,
        title: doc.entry.title,
        description: doc.entry.description,
        sourceUrl: entryUrl(dataset, doc.entry.code),
        datasetVersion: dataset.version,
        matchedTitles,
        matchedTerms,
        rationale: explain(
          scheme,
          doc.entry,
          matched,
          matchedTitles,
          titleKey,
          doc,
        ),
        score: Math.round(score * 100) / 100,
      };
    });
}
const quote = (terms: string[]) => terms.map((t) => `“${t}”`).join(", ");
function explain(
  scheme: OccupationScheme,
  entry: OccupationEntry,
  matched: Record<Field, string[]>,
  matchedTitles: string[],
  titleKey: string,
  doc: Doc,
): string {
  const parts: string[] = [];
  const labels: Record<Field, string> =
    scheme === "UK SOC"
      ? {
          title: "the SOC unit group title",
          altTitles: "the ONS coding index",
          description: "the ONS unit group description",
          tasks: "the ONS task list",
        }
      : {
          title: "the O*NET occupation title",
          altTitles: "O*NET reported job titles",
          description: "the O*NET description",
          tasks: "O*NET task statements and work activities",
        };
  if (titleKey && (doc.titleKey === titleKey || doc.altKeys.includes(titleKey)))
    parts.push(
      `The role title matches ${doc.titleKey === titleKey ? labels.title : "a title in " + labels.altTitles} exactly`,
    );
  for (const f of FIELDS) {
    const terms = [...new Set(matched[f])];
    if (!terms.length) continue;
    if (f === "altTitles" && matchedTitles.length)
      parts.push(
        `${quote(terms)} ${terms.length === 1 ? "appears" : "appear"} in ${labels[f]} (e.g. ${matchedTitles.map((t) => `“${t}”`).join(", ")})`,
      );
    else
      parts.push(
        `${quote(terms)} ${terms.length === 1 ? "appears" : "appear"} in ${labels[f]}`,
      );
  }
  const jurisdiction =
    scheme === "O*NET"
      ? " O*NET describes US occupations; review relevance to the UK setting before use."
      : "";
  return `Keyword match for ${entry.code} ${entry.title}: ${parts.join("; ")}. Suggested by deterministic search, not a published mapping — confirm against the role responsibilities.${jurisdiction}`;
}

/**
 * The best dataset match for each scheme the role has no recorded match for,
 * with the entry's own task statements (Ollie, 27 Oct 2026: every pack carries
 * occupational data so Studio can suggest WORK day tasks from it). Always
 * proposed; a researcher's recorded match for a scheme is never replaced.
 */
export async function automaticOccupations(
  role: Pick<Role, "title" | "responsibilities" | "seniority" | "occupations">,
): Promise<Occupation[]> {
  const out: Occupation[] = [];
  for (const scheme of schemes) {
    if (role.occupations.some((o) => o.scheme === scheme)) continue;
    const [best] = await search(
      scheme,
      { title: role.title, context: role.responsibilities, seniority: role.seniority },
      1,
    );
    if (!best) continue;
    const found = await getEntry(scheme, best.code);
    out.push(
      hydrateDatasetMatch(
        {
          scheme,
          code: best.code,
          title: best.title,
          sourceUrl: best.sourceUrl,
          datasetVersion: best.datasetVersion,
          rationale: `${best.rationale} Attached automatically when the pack was made; confirm against the role.`,
          status: "proposed",
          activities: found.entry.tasks.slice(0, 30),
          skills: [],
          knowledge: [],
          workContext: [],
          basis: "dataset-search",
        },
        found,
      ),
    );
  }
  return out;
}
