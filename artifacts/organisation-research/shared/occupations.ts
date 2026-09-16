/**
 * Bundled official occupational reference data (UK SOC 2020 from the ONS and
 * O*NET from USDOL/ETA). These records describe occupations in general; they
 * never describe a specific employer. Every value carries its dataset identity,
 * version and jurisdiction so exports can label it truthfully.
 */
export type OccupationScheme = "UK SOC" | "O*NET";
export interface OccupationEntry {
  code: string;
  title: string;
  description: string;
  /** Job titles the dataset maps to this occupation (index or reported titles). */
  altTitles: string[];
  tasks: string[];
  /** O*NET generalized work activities with importance; empty for UK SOC. */
  activities: string[];
  skills: string[];
  knowledge: string[];
  workContext: string[];
  /** UK SOC only: typical entry routes and qualifications (ONS wording). */
  entryRoutes?: string;
}
export interface OccupationDataset {
  scheme: OccupationScheme;
  name: string;
  version: string;
  jurisdiction: "UK" | "US";
  publisher: string;
  licence: string;
  sourceUrls: string[];
  /** URL template for one occupation; {code} is replaced with the code. */
  entryUrl: string;
  retrievedAt: string;
  entries: OccupationEntry[];
}
export interface DatasetSummary {
  scheme: OccupationScheme;
  name: string;
  version: string;
  jurisdiction: "UK" | "US";
  publisher: string;
  licence: string;
  sourceUrls: string[];
  retrievedAt: string;
  occupations: number;
}
/** A deterministic search hit with the terms that produced it. */
export interface OccupationCandidate {
  scheme: OccupationScheme;
  jurisdiction: "UK" | "US";
  code: string;
  title: string;
  description: string;
  sourceUrl: string;
  datasetVersion: string;
  /** Alternate titles that matched the query, for display. */
  matchedTitles: string[];
  /** Query terms that matched, grouped by field. */
  matchedTerms: {
    field: "title" | "altTitles" | "description" | "tasks";
    terms: string[];
  }[];
  rationale: string;
  score: number;
}
