export type Review = "unreviewed" | "accepted" | "clarification" | "rejected";
export type FindingKind = "company" | "occupation" | "proposal";
/**
 * Knowledge-base tiers (see docs/knowledge-base-alignment.md §4.1).
 * 1 supplied or confirmed by the organisation · 2 the organisation's public
 * material · 3 the profession · 4 illustrative, invented and declared.
 */
export type Tier = 1 | 2 | 3 | 4;
export const tierNames: Record<Tier, string> = {
  1: "Supplied by the organisation",
  2: "The organisation's public material",
  3: "The profession",
  4: "Illustrative, declared",
};
/** The six sections of the knowledge base; each is also a folder in the export. */
export type Section =
  "organisation" | "role" | "case" | "media" | "brand" | "supplied";
export type Folder =
  | "01-organisation"
  | "02-role"
  | "03-case-material"
  | "04-media"
  | "05-brand"
  | "06-organisation-supplied";
export const sections: {
  section: Section;
  folder: Folder;
  title: string;
  /** Sections whose content is specific to a role. */
  roleScoped: boolean;
}[] = [
  { section: "organisation", folder: "01-organisation", title: "The organisation", roleScoped: false },
  { section: "role", folder: "02-role", title: "The role", roleScoped: true },
  { section: "case", folder: "03-case-material", title: "Case material", roleScoped: true },
  { section: "media", folder: "04-media", title: "Media", roleScoped: true },
  { section: "brand", folder: "05-brand", title: "Brand", roleScoped: false },
  { section: "supplied", folder: "06-organisation-supplied", title: "Supplied by the organisation", roleScoped: false },
];
/** The named places of the document a fact can fill; "none" keeps it in the register only. */
export const slots = [
  { slot: "organisation.paragraph", section: "organisation", label: "In one paragraph", table: false },
  { slot: "organisation.entity", section: "organisation", label: "The entity the learner meets", table: false },
  { slot: "organisation.sites", section: "organisation", label: "Sites and where the role sits", table: false },
  { slot: "organisation.products", section: "organisation", label: "Products, services and customers", table: false },
  { slot: "organisation.size", section: "organisation", label: "Size and numbers", table: false },
  { slot: "organisation.voice", section: "organisation", label: "How it talks about itself", table: false },
  { slot: "organisation.news", section: "organisation", label: "Recent news", table: false },
  { slot: "role.title", section: "role", label: "The role as the organisation names it", table: false },
  { slot: "role.standard", section: "role", label: "Apprenticeship standard", table: false },
  { slot: "role.duty", section: "role", label: "Duties", table: true },
  { slot: "role.ncs", section: "role", label: "National Careers Service profile", table: false },
  { slot: "role.body", section: "role", label: "Professional body", table: false },
  { slot: "role.advert", section: "role", label: "Job adverts", table: true },
  { slot: "role.day", section: "role", label: "A day in the role", table: false },
  { slot: "role.vocabulary", section: "role", label: "Vocabulary", table: true },
  { slot: "case.routine", section: "case", label: "The routine", table: false },
  { slot: "case.measurement", section: "case", label: "Measurements and limits", table: true },
  { slot: "case.equipment", section: "case", label: "Equipment and systems", table: false },
  { slot: "case.fault", section: "case", label: "Faults and how they are checked", table: true },
  { slot: "case.safety", section: "case", label: "Safety rules people actually follow", table: false },
  { slot: "case.people", section: "case", label: "People around the role", table: false },
  { slot: "media.item", section: "media", label: "Media log", table: true },
  { slot: "brand.guidelines", section: "brand", label: "Guidelines and where they live", table: false },
  { slot: "brand.logo", section: "brand", label: "Logo rules", table: false },
  { slot: "brand.colour", section: "brand", label: "Colours", table: true },
  { slot: "brand.type", section: "brand", label: "Typefaces", table: true },
  { slot: "brand.photography", section: "brand", label: "Photography", table: false },
  { slot: "brand.house-style", section: "brand", label: "House style", table: false },
  { slot: "brand.screenshot", section: "brand", label: "Screenshots", table: false },
  { slot: "supplied.document", section: "supplied", label: "Documents received", table: true },
  { slot: "supplied.interview", section: "supplied", label: "The interview", table: true },
  { slot: "supplied.may-use", section: "supplied", label: "Names we may use", table: false },
  { slot: "supplied.must-not-say", section: "supplied", label: "Things we must not say", table: false },
] as const satisfies readonly { slot: string; section: Section; label: string; table: boolean }[];
export type Slot = (typeof slots)[number]["slot"] | "none";
export const sectionOfSlot = (slot: Slot | undefined): Section | undefined =>
  slots.find((s) => s.slot === slot)?.section;
/** Chapter parts a fact feeds. */
export type Part = "day" | "workflow" | "matters" | "call";
export const partNames: Record<Part, string> = {
  day: "A day in the role",
  workflow: "Follow the workflow",
  matters: "What matters first",
  call: "Make the call",
};
export interface SectionSummary {
  section: Section;
  folder: Folder;
  title: string;
  roleScoped: boolean;
  slots: {
    slot: Slot;
    label: string;
    table: boolean;
    findingIds: string[];
    filled: boolean;
  }[];
  filled: number;
  total: number;
  sourceIds: string[];
  /** Readable sources available to extraction in this folder. */
  readableSourceIds?: string[];
  /** Source titles in this folder, in source order. */
  sourceTitles?: string[];
  gaps: string[];
  /** Folder status in scope; gathering when never set. */
  status: SectionStatus;
  /** Sources added to the folder after the last extraction. */
  addedSinceExtraction: number;
  /** Legacy facts in scope still carrying an old review value. */
  unreviewed: number;
  /** Designer's note for the section in scope; null when none has been written. */
  note: SectionNote | null;
}
export interface SectionsResponse {
  sections: SectionSummary[];
  missing: string[];
}
export interface Verified {
  by: string;
  at: string;
  note?: string;
}
export type Rights = "organisation-supplied" | "press-kit" | "reference-only";
/**
 * Folder-first workflow (docs/knowledge-base-alignment.md §9): a section's
 * folder is gathering until the worker extracts it. Review is an optional
 * reviewer/admin sign-off. "complete" remains only for stored legacy data.
 */
export type SectionStage = "gathering" | "complete" | "extracted" | "reviewed";
export const sectionStageNames: Record<SectionStage, string> = {
  gathering: "Gathering",
  complete: "Gathering",
  extracted: "Extracted",
  reviewed: "Reviewed",
};
export interface SectionStatus {
  stage: SectionStage;
  by: string;
  at: string;
  /** Automatic stage hidden by the optional reviewed tick. */
  reviewedFrom?: "gathering" | "extracted";
}
/** Designer's note for a section: free Markdown text shown at the top of the section, kept apart from the facts. */
export interface SectionNote {
  text: string;
  by: string;
  at: string;
}
/** Longest designer's note accepted, in characters. */
export const sectionNoteMaxLength = 20_000;
export type Permission =
  "research-only" | "awaiting-confirmation" | "learner-approved";
export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface Organisation extends Base {
  name: string;
  website: string;
  country: string;
  division: string;
  owner: string;
  summary: string;
  logoSourceId?: string;
  brandNotes: string;
  /** Who at the organisation checks facts; absent = not yet known. */
  factChecker?: { name: string; jobTitle: string };
  /** Brand prose (section 5); colours and typefaces are facts in the brand.colour / brand.type slots. */
  brand?: {
    guidelines: string;
    logo: string;
    photography: string;
    houseStyle: string;
  };
  /** Names we may use and things we must not say; each must cite a tier-1 source. */
  mayUse?: Attributed[];
  mustNotSay?: Attributed[];
  /** Folder status of the organisation-wide sections (organisation, brand, supplied). */
  sectionStatus?: Partial<Record<Section, SectionStatus>>;
  /** Designer's notes per section in this scope. */
  sectionNotes?: Partial<Record<Section, SectionNote>>;
}
export interface Attributed {
  text: string;
  sourceId: string;
}
/** The profession's own documents for a role (plan §4.6). */
export interface ApprenticeshipStandard {
  name: string;
  level: string;
  duration: string;
  url: string;
  assessmentPlanUrl: string;
}
export interface ProfessionalBody {
  name: string;
  registrationRoute: string;
  frameworkUrl: string;
}
export interface Interview {
  who: string;
  jobTitle: string;
  timeInRole: string;
  mayBeNamed: boolean;
  date: string;
  how: string;
  recordingSourceId?: string;
  transcriptSourceId?: string;
}
/** Columns of the table slots (plan §4.3); the claim is generated from them. */
export const slotFields: Partial<Record<Slot, { key: string; label: string; list?: boolean; required?: boolean }[]>> = {
  "role.duty": [
    { key: "duty", label: "Duty", required: true },
    { key: "plainWords", label: "In plain words" },
    { key: "part", label: "Chapter part" },
  ],
  "role.advert": [
    { key: "title", label: "Title", required: true },
    { key: "postedWhere", label: "Posted where" },
    { key: "siteAndTeam", label: "Site and team" },
    { key: "shiftPattern", label: "Shift pattern" },
    { key: "systemsNamed", label: "Systems named", list: true },
    { key: "fileSourceId", label: "Saved advert (source)" },
    { key: "date", label: "Date" },
  ],
  "role.vocabulary": [
    { key: "term", label: "Term", required: true },
    { key: "meaning", label: "Meaning", required: true },
  ],
  "case.measurement": [
    { key: "reading", label: "Reading", required: true },
    { key: "unit", label: "Unit" },
    { key: "reviewLine", label: "Review line" },
    { key: "limit", label: "Limit" },
    { key: "origin", label: "Origin (source, or invented and declared)", required: true },
  ],
  "case.fault": [
    { key: "problem", label: "Problem", required: true },
    { key: "likelyCauses", label: "Likely causes", list: true },
    { key: "howChecked", label: "How it is checked" },
  ],
  "brand.colour": [
    { key: "name", label: "Name", required: true },
    { key: "hex", label: "Hex" },
    { key: "whereSeen", label: "Where seen" },
  ],
  "brand.type": [
    { key: "face", label: "Typeface", required: true },
    { key: "whereUsed", label: "Where used" },
    { key: "licence", label: "Licence" },
  ],
  "media.item": [
    { key: "whatItShows", label: "What it shows", required: true },
    { key: "rights", label: "Rights" },
    { key: "transcriptSourceId", label: "Transcript (source)" },
    { key: "timecode", label: "Timecode" },
  ],
  "supplied.document": [
    { key: "whatItIs", label: "What it is", required: true },
    { key: "fromWhom", label: "From whom" },
    { key: "settles", label: "What it settles (question or fact ids)", list: true },
  ],
  "supplied.interview": [
    { key: "question", label: "Question", required: true },
    { key: "answerInTheirWords", label: "Answer in their words", required: true },
    { key: "timecode", label: "Timecode" },
    { key: "usedIn", label: "Used in", list: true },
  ],
};
export interface Occupation {
  scheme: "UK SOC" | "O*NET";
  code: string;
  title: string;
  sourceUrl: string;
  datasetVersion: string;
  rationale: string;
  status: "proposed" | "confirmed";
  activities: string[];
  skills: string[];
  knowledge: string[];
  workContext: string[];
  /** How the relationship was established; absent on older records (manual). */
  basis?: "manual" | "dataset-search";
  /** Jurisdiction of the dataset: UK SOC is UK; O*NET is US. */
  jurisdiction?: "UK" | "US";
  /** When the bundled dataset extract was retrieved (dataset-search matches). */
  retrievedAt?: string;
}
export type ReviewState = "draft" | "in-review" | "ready";
export interface Role extends Base {
  orgId: string;
  title: string;
  location: string;
  seniority: string;
  responsibilities: string;
  boundaries: string;
  occupations: Occupation[];
  /** Pack review state (PRD: draft → in review → ready). Absent = draft. */
  reviewState?: ReviewState;
  reviewStateBy?: string;
  reviewStateAt?: string;
  reviewStateNote?: string;
  /** Content fingerprint taken when marked ready; edits since revert to draft. */
  readyFingerprint?: string;
  /** Server-computed: true when content changed after the role was marked ready. */
  reviewChanged?: boolean;
  /** The profession's own documents (plan §4.6); UK SOC stays the primary classification. */
  standard?: ApprenticeshipStandard;
  ncsUrl?: string;
  professionalBody?: ProfessionalBody;
  /** One interview per pack. */
  interview?: Interview;
  /** Folder status of the role-scoped sections (role, case, media). */
  sectionStatus?: Partial<Record<Section, SectionStatus>>;
  /** Designer's notes per section in this scope. */
  sectionNotes?: Partial<Record<Section, SectionNote>>;
}
export interface Source extends Base {
  orgId: string;
  roleIds: string[];
  title: string;
  kind:
    | "web"
    | "document"
    | "statement"
    | "image"
    | "occupation"
    | "film"
    | "advert"
    | "screenshot"
    | "standard"
    | "guidance"
    /** A team-written research note (Markdown) recording what was read and where. */
    | "note";
  /** Notes: where the material was extracted from (URL or description). */
  extractedFrom?: string;
  /** Knowledge-base folder; absent = derived from kind and verification (server view fills it). */
  folder?: Folder;
  /** Tier override with a reason; absent = derived (server view fills `tier`). */
  tier?: Tier;
  tierReason?: string;
  /** Media only: how we may use it. Required before a pack is ready. */
  rights?: Rights;
  /** Films: the transcript source; stills lifted from a film: where in it. */
  transcriptSourceId?: string;
  timecode?: string;
  /** The organisation's contact who supplied the material (distinct from suppliedBy, the team member). */
  providedBy?: { name: string; jobTitle: string };
  /** Server-computed: the file name used in the export, YYYY-MM-DD_where-from_topic.ext. */
  exportName?: string;
  url: string;
  text: string;
  locator: string;
  permission: Permission;
  verification: "public-source" | "user-supplied" | "client-confirmed";
  suppliedBy: string;
  publishedAt: string;
  retrievedAt: string;
  mime?: string;
  filename?: string;
  /** Legacy: uploads once lived here as base64; they now live beside the workspace and are moved out on start-up. */
  blob?: string;
  error?: string;
  caption?: string;
  runIds: string[];
  /** Web captures: the earlier capture this one refreshed, and vice versa. */
  supersedes?: string;
  supersededBy?: string;
  /** Stored on a refreshed capture: what changed against the capture it supersedes. */
  captureDiff?: CaptureDiff;
}
export interface CaptureDiff {
  previousId: string;
  changed: boolean;
  added: string[];
  removed: string[];
  /** Findings whose exact quotation no longer appeared in the new capture. */
  affectedFindingIds: string[];
}
export interface Citation {
  sourceId: string;
  quote: string;
  locator: string;
  /**
   * Set by the server when the quote was not found word for word in its
   * source. The fact is kept and flagged for a check rather than refused
   * (Ollie, 27 Oct 2026: quotations are flagged, not enforced).
   */
  unmatched?: boolean;
}
export interface Finding extends Base {
  orgId: string;
  roleId?: string;
  kind: FindingKind;
  claim: string;
  citations: Citation[];
  review: Review;
  rationale: string;
  /** Where in the document the fact belongs; absent = "none" (register only). */
  slot?: Slot;
  /** Chapter parts the fact feeds. */
  parts?: Part[];
  /** Typed columns for table slots (docs/knowledge-base-alignment.md §4.3); the claim is generated from them. */
  fields?: Record<string, unknown>;
  /** Set by a reviewer when the organisation confirms the fact; verified facts are tier 1. */
  verified?: Verified;
  /** Server-computed: lowest tier among cited sources, 1 if verified, 4 without a citation. */
  tier?: Tier;
  reviewer?: string;
  reviewedAt?: string;
  runIds: string[];
  history: {
    at: string;
    actor: string;
    claim: string;
    review: Review;
    rationale: string;
    /** Verification in force before this change, when there was one. */
    verified?: Verified;
  }[];
  /** Recorded when a cited web source is refreshed; a missing quote needs review. */
  sourceChanges?: {
    at: string;
    sourceId: string;
    newSourceId: string;
    quoteFound: boolean;
  }[];
}
export interface Question extends Base {
  orgId: string;
  roleId?: string;
  text: string;
  why: string;
  blocking: boolean;
  status: "open" | "client" | "deferred" | "answered";
  answer: string;
  answeredBy?: string;
  assignee: string;
  provenance: string;
  runIds: string[];
}
export interface Activity extends Base {
  orgId: string;
  roleId: string;
  title: string;
  action: string;
  output: string;
  materials: string;
  learning: string;
  confirmation: string;
  findingIds: string[];
  review: Review;
  runIds: string[];
}
export interface ResearchJob extends Base {
  orgId: string;
  roleId?: string;
  /** Knowledge-base sections this run was asked to fill. */
  sections?: Section[];
  /** Exact readable sources selected for this run. */
  sourceIds?: string[];
  /** Also read the organisation's website; absent = crawl only when no sources were selected. */
  crawl?: boolean;
  tier: "economy" | "power" | "max";
  status:
    "queued" | "researching" | "completed" | "gaps" | "failed" | "cancelled";
  stage: string;
  errors: string[];
  requestedBy: string;
  /** Version of the research instructions used for this run (0 = built-in default). */
  promptVersion?: number;
  leaseUntil?: string;
  attempts: number;
  runs: {
    id: string;
    model: string;
    status: string;
    findings: number;
    inputTokens: number;
    outputTokens: number;
  }[];
}
export interface Member {
  userId: string;
  name: string;
  role: "researcher" | "reviewer" | "admin";
  active: boolean;
  /** Verified primary email of the Clerk account, lower-cased, when known. */
  email?: string;
}
/**
 * Access granted to a work email address before its owner has signed in.
 * Redeemed (turned into a Member) on the first request from a Clerk account
 * whose verified primary email matches.
 */
export interface Invitation {
  id: string;
  email: string;
  name: string;
  role: Member["role"];
  invitedBy: string;
  invitedAt: string;
}
export interface Audit {
  id: string;
  at: string;
  actor: string;
  action: string;
  subjectId: string;
}
/** One model position in the research tiers; Max runs two independent analyses. */
export type ModelSlot = "economy" | "power" | "maxClaude" | "maxOpenai";
export interface PromptSettings {
  /** The editable research instructions; the output contract and evidence are appended by the server. */
  instructions: string;
  /** Monotonic; recorded on each research job for provenance. 0 means the built-in default. */
  version: number;
  updatedAt: string;
  updatedBy: string;
}
export interface ResearchSettings {
  /** Model overrides per slot; the deployment's environment variables remain the default. */
  models: Partial<Record<ModelSlot, string>>;
  prompt?: PromptSettings;
}
export interface Workspace {
  organisations: Organisation[];
  roles: Role[];
  sources: Source[];
  findings: Finding[];
  questions: Question[];
  activities: Activity[];
  jobs: ResearchJob[];
  members: Member[];
  /** Absent in workspaces stored before email invitations existed. */
  invitations?: Invitation[];
  audit: Audit[];
  /** Idempotent data migrations already applied to this workspace. */
  migrations?: string[];
  /** Absent in workspaces stored before research settings existed. */
  settings?: ResearchSettings;
}
interface PackBase {
  id: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  reviewer: string;
  status: "draft" | "ready";
  /** Kept under its original key in every schema: research readiness is never the organisation's approval. */
  employerApproval: false;
  organisation: Organisation;
  role: Role;
  findings: Finding[];
  sources: Omit<Source, "blob">[];
  activities: Activity[];
  questions: Question[];
  limitations: string[];
}
/** Packs created before the knowledge-base layout; stored snapshots stay readable as they are. */
export interface PackV1 extends PackBase {
  schemaVersion: "1.0.0";
}
/** A fact placed in the document: the finding plus its computed tier and register number. */
export interface RegisterRow {
  n: number;
  findingId: string;
  slot: Slot;
  tier: Tier;
  claim: string;
  sourceIds: string[];
  date: string;
  parts: Part[];
  verified: boolean;
}
export interface PackV2 extends PackBase {
  schemaVersion: "2.0.0";
  header: {
    /** The organisation as it writes its own name. */
    organisation: string;
    /** The entity the learner meets (the division field). */
    entity: string;
    /** The role as the organisation names it. */
    role: string;
    compiledBy: string;
    started: string;
    lastUpdated: string;
    factChecker: string;
  };
  tiers: Record<Tier, string>;
  /** Facts grouped by slot in the document's order; empty slots are listed so gaps are visible. */
  sections: {
    section: Section;
    folder: Folder;
    title: string;
    slots: { slot: Slot; label: string; findingIds: string[] }[];
    /** Designer's note snapshotted with the pack; absent when none was written. */
    note?: SectionNote;
  }[];
  register: RegisterRow[];
  /** "For the organisation to confirm": rows at tiers 2–4 used by a chapter part and not verified. */
  toConfirm: RegisterRow[];
}
export type Pack = PackV1 | PackV2;
export interface Session {
  userId: string;
  name: string;
  role: Member["role"];
  demo: boolean;
}
export const emptyWorkspace = (): Workspace => ({
  organisations: [],
  roles: [],
  sources: [],
  findings: [],
  questions: [],
  activities: [],
  jobs: [],
  members: [],
  invitations: [],
  audit: [],
  settings: { models: {} },
});
export const labels: Record<string, string> = {
  company: "Organisation fact",
  occupation: "Occupational context",
  proposal: "Design proposal",
  unreviewed: "Needs review",
  accepted: "Registered",
  clarification: "Needs clarification",
  rejected: "Excluded",
  open: "Open",
  client: "Ask the organisation",
  deferred: "Deferred",
  answered: "Answered",
  queued: "Queued",
  researching: "Researching",
  completed: "Complete",
  gaps: "Complete with gaps",
  failed: "Failed",
  cancelled: "Cancelled",
  "research-only": "Research only",
  "awaiting-confirmation": "Permission unconfirmed",
  "learner-approved": "Approved for learner use",
  draft: "Draft",
  "in-review": "In review",
  ready: "Ready for storyboard drafting",
};
