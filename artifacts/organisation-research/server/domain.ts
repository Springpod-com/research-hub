import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Workspace,
  Base,
  Pack,
  Member,
  Source,
  Citation,
  Finding,
  Organisation,
  Role,
  Occupation,
  Tier,
  Folder,
  PackV2,
  SectionsResponse,
  Slot,
  SectionStatus,
} from "../shared/types.js";
import {
  sections,
  slots,
  slotFields,
  tierNames,
} from "../shared/types.js";
import {
  buildQuotationIndex,
  locateQuotation,
  type QuotationIndex,
} from "./quotation.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
export const base = (): Base => ({
  id: randomUUID(),
  createdAt: now(),
  updatedAt: now(),
  version: 1,
});
export const text = z.string().trim().min(1).max(8000);
export const optionalText = z.string().trim().max(20000).default("");
export const url = z
  .union([
    z.literal(""),
    z
      .string()
      .url()
      .refine(
        (v) => ["http:", "https:"].includes(new URL(v).protocol),
        "Use a public HTTP(S) address",
      ),
  ])
  .default("");
export const review = z.enum([
  "unreviewed",
  "accepted",
  "clarification",
  "rejected",
]);
export const orgInput = z.object({
  name: text.max(150),
  website: url,
  country: text.max(80),
  division: optionalText,
  summary: optionalText,
  brandNotes: optionalText,
});
const personInput = z.object({ name: text.max(200), jobTitle: optionalText }).strict();
const brandInput = z.object({
  guidelines: z.string().trim().max(8000),
  logo: z.string().trim().max(8000),
  photography: z.string().trim().max(8000),
  houseStyle: z.string().trim().max(8000),
}).strict();
const attributedInput = z.object({
  text: text,
  sourceId: z.string().uuid(),
}).strict();
export const orgPatchInput = orgInput.extend({
  factChecker: personInput.nullable().optional(),
  brand: brandInput.nullable().optional(),
  mayUse: z.array(attributedInput).max(100).nullable().optional(),
  mustNotSay: z.array(attributedInput).max(100).nullable().optional(),
});
export const roleInput = z.object({
  title: text.max(150),
  location: optionalText,
  seniority: optionalText,
  responsibilities: optionalText,
  boundaries: optionalText,
});
const standardInput = z.object({
  name: text.max(300),
  level: text.max(100),
  duration: text.max(200),
  url: url,
  assessmentPlanUrl: url,
}).strict();
const professionalBodyInput = z.object({
  name: text.max(300),
  registrationRoute: z.string().trim().max(8000),
  frameworkUrl: url,
}).strict();
const interviewInput = z.object({
  who: text.max(300),
  jobTitle: text.max(300),
  timeInRole: z.string().trim().max(500),
  mayBeNamed: z.boolean(),
  date: z.string().trim().max(100),
  how: z.string().trim().max(1000),
  recordingSourceId: z.string().uuid().optional(),
  transcriptSourceId: z.string().uuid().optional(),
}).strict();
export const rolePatchInput = roleInput.extend({
  standard: standardInput.nullable().optional(),
  ncsUrl: url.nullable().optional(),
  professionalBody: professionalBodyInput.nullable().optional(),
  interview: interviewInput.nullable().optional(),
});
export const citation = z.object({
  sourceId: z.string().uuid(),
  quote: z
    .string()
    .trim()
    .min(1, "Paste the exact supporting passage from the source.")
    .max(3000),
  locator: z.string().max(300).default("Source excerpt"),
});
export const findingInput = z.object({
  claim: text.optional(),
  kind: z.enum(["company", "occupation", "proposal"]),
  roleId: z.string().uuid().optional(),
  citations: z.array(citation).max(12),
  rationale: optionalText,
  slot: z.enum(["none", ...slots.map((slot) => slot.slot)] as [string, ...string[]]).optional(),
  parts: z.array(z.enum(["day", "workflow", "matters", "call"])).max(4).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});
export const questionInput = z.object({
  text: text,
  why: optionalText,
  roleId: z.string().uuid().optional(),
  blocking: z.boolean().default(false),
  assignee: optionalText,
});
export const occupationInput = z
  .object({
    scheme: z.enum(["UK SOC", "O*NET"]),
    code: text.max(30),
    title: text.max(200),
    sourceUrl: z.string().url(),
    datasetVersion: text.max(200),
    rationale: text,
    status: z.enum(["proposed", "confirmed"]).default("proposed"),
    activities: z.array(text).max(30).default([]),
    skills: z.array(text).max(30).default([]),
    knowledge: z.array(text).max(30).default([]),
    workContext: z.array(text).max(30).default([]),
    basis: z.enum(["manual", "dataset-search"]).default("manual"),
    jurisdiction: z.enum(["UK", "US"]).optional(),
    retrievedAt: z.string().datetime().optional(),
  })
  .refine(
    (o) =>
      o.scheme === "UK SOC"
        ? /^\d{4}(\d{2})?$/.test(o.code)
        : /^\d{2}-\d{4}\.\d{2}$/.test(o.code),
    "Use the dataset’s exact occupation code",
  );
export type OccupationInput = z.infer<typeof occupationInput>;
/**
 * A dataset-search match must describe the dataset entry it names: identity
 * fields come from the bundled dataset, statements must be the dataset's own,
 * and it is always recorded as proposed for a human to confirm.
 */
export function hydrateDatasetMatch(
  data: OccupationInput,
  found: {
    dataset: {
      version: string;
      jurisdiction: "UK" | "US";
      retrievedAt: string;
    };
    sourceUrl: string;
    entry: {
      title: string;
      tasks: string[];
      activities: string[];
      skills: string[];
      knowledge: string[];
      workContext: string[];
    };
  },
): OccupationInput {
  const { entry } = found;
  const allowed: [keyof OccupationInput, string[]][] = [
    ["activities", [...entry.tasks, ...entry.activities]],
    ["skills", entry.skills],
    ["knowledge", entry.knowledge],
    ["workContext", entry.workContext],
  ];
  for (const [field, values] of allowed) {
    const set = new Set(values);
    if ((data[field] as string[]).some((v) => !set.has(v)))
      throw new HttpError(
        422,
        `Selected ${String(field)} must be statements from the dataset entry.`,
      );
  }
  return {
    ...data,
    title: entry.title,
    sourceUrl: found.sourceUrl,
    datasetVersion: found.dataset.version,
    jurisdiction: found.dataset.jurisdiction,
    retrievedAt: found.dataset.retrievedAt,
    status: "proposed",
    basis: "dataset-search",
  };
}
export function requireRole(member: Member, roles: Member["role"][]) {
  if (!member.active || !roles.includes(member.role))
    throw new HttpError(403, "Your workspace role cannot perform this action.");
}
export function get<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((x) => x.id === id);
  if (!item) throw new HttpError(404, "Record not found.");
  return item;
}
export function touch<T extends Base>(item: T, expected: unknown) {
  if (expected !== item.version)
    throw new HttpError(
      409,
      "This record changed. Refresh it before saving your changes.",
    );
  item.version++;
  item.updatedAt = now();
}
export function roleInOrg(w: Workspace, orgId: string, roleId?: string) {
  get(w.organisations, orgId);
  if (roleId && get(w.roles, roleId).orgId !== orgId)
    throw new HttpError(404, "Role not found in this organisation.");
}
export function audit(
  w: Workspace,
  actor: string,
  action: string,
  subjectId: string,
) {
  w.audit.unshift({ id: randomUUID(), at: now(), actor, action, subjectId });
  w.audit = w.audit.slice(0, 10000);
}
const shortTitle = (s: Source) =>
  s.title.length > 80 ? `${s.title.slice(0, 77)}…` : s.title;
export function validateCitations(
  sources: Source[],
  orgId: string,
  kind: string,
  citations: Citation[],
  quotationIndexes = new Map<string, QuotationIndex>(),
) {
  if (kind !== "proposal" && !citations.length)
    throw new HttpError(
      422,
      "Facts about the organisation and occupational context need a supporting source passage. Choose a source and paste the exact passage, or classify the fact as a design proposal.",
    );
  for (const c of citations) {
    const s = get(sources, c.sourceId);
    if (s.orgId !== orgId)
      throw new HttpError(422, "Evidence must belong to this organisation.");
    if (!s.text.trim())
      throw new HttpError(
        422,
        `“${shortTitle(s)}” has no captured text, so it cannot supply a quotation. Images are not read automatically; cite a web page or text document, or record the point as a design proposal.`,
      );
    let quotationIndex = quotationIndexes.get(s.id);
    if (!quotationIndex) {
      quotationIndex = buildQuotationIndex(s.text);
      quotationIndexes.set(s.id, quotationIndex);
    }
    // Flag, don't refuse: the fact keeps its source and is marked for a check.
    if (locateQuotation(quotationIndex, c.quote) === null) c.unmatched = true;
    else delete c.unmatched;
    if (kind === "company" && s.kind === "occupation")
      throw new HttpError(
        422,
        "Occupational context cannot establish a fact about the organisation.",
      );
  }
}

const rights = new Set(["organisation-supplied", "press-kit", "reference-only"]);
const shown = (value: unknown) =>
  Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "";
const sentence = (...parts: (string | undefined)[]) =>
  parts.filter((part) => part?.trim()).join("; ");

/** Validate a table row and return the claim which represents that row everywhere. */
export function structuredFinding(
  sources: Source[],
  orgId: string,
  slot: Slot | undefined,
  fields: Record<string, unknown> | undefined,
  citations: Citation[],
  records?: Pick<Workspace, "findings" | "questions">,
): { fields?: Record<string, unknown>; claim?: string } {
  if (!fields) return {};
  const columns = slot ? slotFields[slot] : undefined;
  if (!columns)
    throw new HttpError(422, "Structured fields are only valid for a table slot.");
  const allowed = new Set(columns.map((column) => column.key));
  const unknown = Object.keys(fields).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new HttpError(422, `Unknown structured field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  for (const column of columns) {
    const value = fields[column.key];
    if (column.required && (typeof value !== "string" || !value.trim()))
      throw new HttpError(422, `${column.label} is required.`);
    if (value !== undefined && column.list && (!Array.isArray(value) || value.some((item) => typeof item !== "string")))
      throw new HttpError(422, `${column.label} must be a list of text values.`);
    if (value !== undefined && !column.list && typeof value !== "string")
      throw new HttpError(422, `${column.label} must be text.`);
  }
  if (slot === "media.item" && fields.rights !== undefined && !rights.has(String(fields.rights)))
    throw new HttpError(422, "Rights must be organisation-supplied, press-kit or reference-only.");
  const sourceReference =
    slot === "role.advert"
      ? fields.fileSourceId
      : slot === "media.item"
        ? fields.transcriptSourceId
        : undefined;
  if (sourceReference) {
    const source = sources.find((item) => item.id === sourceReference);
    if (!source || source.orgId !== orgId)
      throw new HttpError(422, "A structured source reference must belong to this organisation.");
  }
  const recordReferences =
    slot === "supplied.document"
      ? fields.settles
      : slot === "supplied.interview"
        ? fields.usedIn
        : undefined;
  if (Array.isArray(recordReferences)) {
    if (recordReferences.length && !records)
      throw new HttpError(
        422,
        "Structured fact and question references must belong to this organisation.",
      );
    const validIds = new Set(
      records
        ? [
            ...records.findings
              .filter((item) => item.orgId === orgId)
              .map((item) => item.id),
            ...records.questions
              .filter((item) => item.orgId === orgId)
              .map((item) => item.id),
          ]
        : [],
    );
    for (const id of recordReferences)
      if (!validIds.has(id))
        throw new HttpError(
          422,
          "Structured fact and question references must belong to this organisation.",
        );
  }
  if (slot === "case.measurement") {
    const origin = String(fields.origin);
    if (origin === "invented and declared") {
      if (citations.length)
        throw new HttpError(422, "An invented and declared measurement must not have citations.");
    } else {
      const source = sources.find((item) => item.id === origin);
      if (!source || source.orgId !== orgId)
        throw new HttpError(422, "Measurement origin must be a source in this organisation or “invented and declared”.");
    }
  }
  const f = (key: string) => shown(fields[key]);
  const claims: Partial<Record<Slot, string>> = {
    "role.duty": f("plainWords") ? `${f("duty")} — ${f("plainWords")}` : f("duty"),
    "role.advert": sentence(f("title"), f("postedWhere") && `posted at ${f("postedWhere")}`, f("siteAndTeam"), f("shiftPattern") && `shift pattern ${f("shiftPattern")}`, f("systemsNamed") && `systems ${f("systemsNamed")}`, f("fileSourceId") && `saved advert ${f("fileSourceId")}`, f("date")),
    "role.vocabulary": `${f("term")} — ${f("meaning")}`,
    "case.measurement": `${f("reading")}${f("unit") ? ` ${f("unit")}` : ""}; review line ${f("reviewLine") || "—"}; limit ${f("limit") || "—"} (${f("origin")})`,
    "case.fault": sentence(f("problem"), f("likelyCauses") && `likely causes ${f("likelyCauses")}`, f("howChecked") && `checked by ${f("howChecked")}`),
    "brand.colour": sentence(f("name"), f("hex"), f("whereSeen") && `seen ${f("whereSeen")}`),
    "brand.type": sentence(f("face"), f("whereUsed") && `used ${f("whereUsed")}`, f("licence") && `licence ${f("licence")}`),
    "media.item": sentence(f("whatItShows"), f("rights") && `rights ${f("rights")}`, f("transcriptSourceId") && `transcript ${f("transcriptSourceId")}`, f("timecode") && `timecode ${f("timecode")}`),
    "supplied.document": sentence(f("whatItIs"), f("fromWhom") && `from ${f("fromWhom")}`, f("settles") && `settles ${f("settles")}`),
    "supplied.interview": sentence(f("question"), f("answerInTheirWords"), f("timecode") && `timecode ${f("timecode")}`, f("usedIn") && `used in ${f("usedIn")}`),
  };
  return { fields, claim: claims[slot!] };
}

export function validateOrganisationReferences(
  sources: Source[],
  orgId: string,
  entries: { sourceId: string }[] | null | undefined,
) {
  for (const entry of entries || []) {
    const source = sources.find((item) => item.id === entry.sourceId);
    if (!source || source.orgId !== orgId || sourceView(source).tier !== 1)
      throw new HttpError(422, "Names we may use and things we must not say must cite a tier-1 source in this organisation.");
  }
}

export function validateRoleReferences(
  sources: Source[],
  orgId: string,
  interview: { recordingSourceId?: string; transcriptSourceId?: string } | null | undefined,
) {
  for (const id of [interview?.recordingSourceId, interview?.transcriptSourceId].filter(Boolean) as string[]) {
    const source = sources.find((item) => item.id === id);
    if (!source || source.orgId !== orgId)
      throw new HttpError(422, "Interview recordings and transcripts must belong to this organisation.");
  }
}
export function readiness(w: Workspace, orgId: string, roleId: string) {
  roleInOrg(w, orgId, roleId);
  const role = get(w.roles, roleId);
  const organisation = get(w.organisations, orgId);
  const relevant = w.findings.filter(
    (f) => f.orgId === orgId && (!f.roleId || f.roleId === roleId),
  );
  const packSources = w.sources.filter(
    (s) =>
      s.orgId === orgId &&
      sourceView(s).folder === "04-media" &&
      (!s.roleIds.length ||
        s.roleIds.includes(roleId) ||
        relevant.some(
          (fact) =>
            fact.review === "accepted" &&
            fact.citations.some((citation) => citation.sourceId === s.id),
        )),
  );
  const issues: string[] = [];
  if (!role.responsibilities.trim())
    issues.push("Describe the role responsibilities.");
  if (!relevant.some((f) => f.kind === "company" && f.review === "accepted"))
    issues.push(
      "Accept at least one evidence-backed fact about the organisation.",
    );
  if (
    w.questions.some(
      (q) =>
        q.orgId === orgId &&
        (!q.roleId || q.roleId === roleId) &&
        q.blocking &&
        q.status !== "answered",
    )
  )
    issues.push("Resolve questions marked as blocking.");
  if (
    w.jobs.some(
      (j) =>
        j.orgId === orgId &&
        (!j.roleId || j.roleId === roleId) &&
        ["queued", "researching"].includes(j.status),
    )
  )
    issues.push("Wait for research to finish or cancel the run.");
  for (const f of relevant.filter((f) => f.review === "accepted"))
    try {
      validateCitations(w.sources, orgId, f.kind, f.citations);
    } catch {
      issues.push("Repair the evidence references for an accepted fact.");
    }
  const mediaFacts = relevant.filter(
    (f) => f.review === "accepted" && f.slot === "media.item",
  );
  try {
    validateOrganisationReferences(
      w.sources,
      orgId,
      [...(organisation.mayUse || []), ...(organisation.mustNotSay || [])],
    );
  } catch {
    issues.push(
      "A name we may use or a thing we must not say cites a source that is no longer tier 1.",
    );
  }
  if (
    packSources.some(
      (source) => !source.rights,
    ) ||
    mediaFacts.some(
      (fact) =>
        typeof fact.fields?.rights !== "string" ||
        !fact.fields.rights.trim(),
    )
  )
    issues.push("Add a rights note to every media item.");
  if (
    packSources.some(
      (source) =>
        source.kind === "film" &&
        !source.transcriptSourceId?.trim() &&
        !/\bno transcript\b/i.test(source.caption || "") &&
        !mediaFacts.some(
          (fact) =>
            fact.citations.some((citation) => citation.sourceId === source.id) &&
            /\bno transcript\b/i.test(fact.rationale),
        ),
    )
  )
    issues.push("Add a transcript for every film, or state why there is no transcript.");
  if (
    relevant.some(
      (fact) =>
        fact.review === "accepted" &&
        findingView(w, fact).tier === 4 &&
        !/\b(invented|illustrative)\b/i.test(fact.rationale),
    )
  )
    issues.push("State that every tier-4 fact is invented or illustrative in its rationale.");
  if (
    relevant.some(
      (fact) =>
        fact.review === "accepted" &&
        fact.slot === "case.measurement" &&
        (typeof fact.fields?.origin !== "string" ||
          !fact.fields.origin.trim()),
    )
  )
    issues.push("Add an origin to every case measurement.");
  if (
    !organisation.factChecker ||
    !organisation.factChecker.name.trim()
  )
    issues.push("Name the organisation's fact checker or record them as not yet known.");
  return [...new Set(issues)];
}
export function sourceView(source: Source): Source {
  const folder: Folder =
    source.folder ||
    (source.providedBy || source.verification === "client-confirmed"
      ? "06-organisation-supplied"
      : ["image", "film"].includes(source.kind)
        ? "04-media"
        : source.kind === "screenshot"
          ? "05-brand"
          : ["advert", "standard", "guidance", "occupation"].includes(source.kind)
            ? "02-role"
            : "01-organisation");
  const tier: Tier =
    source.tier ||
    (source.providedBy || source.verification === "client-confirmed"
      ? 1
      : ["occupation", "standard", "guidance"].includes(source.kind)
        ? 3
        : 2);
  let whereFrom = tier === 1 ? "organisation" : "team";
  if (source.kind === "web" && source.url) {
    try {
      whereFrom = new URL(source.url).hostname.replace(/^www\./, "") || whereFrom;
    } catch {
      // Stored legacy URLs may not parse; the tier-based name remains usable.
    }
  }
  const topic =
    source.title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "source";
  const ext =
    source.kind === "note"
      ? "md"
      : source.filename?.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ||
        "txt";
  const date = /^\d{4}-\d{2}-\d{2}/.exec(source.retrievedAt)?.[0] || "unknown-date";
  return {
    ...source,
    folder,
    tier,
    exportName: `${date}_${whereFrom.toLowerCase().replace(/[^a-z0-9.-]+/g, "-")}_${topic}.${ext}`,
  };
}
export function findingView(w: Workspace, finding: Finding): Finding {
  const tier: Tier = finding.verified
    ? 1
    : !finding.citations.length
      ? 4
      : finding.citations.reduce<Tier>((lowest, citation) => {
          const source = w.sources.find((s) => s.id === citation.sourceId);
          return Math.min(lowest, source ? sourceView(source).tier! : 4) as Tier;
        }, 4);
  return { ...finding, tier, slot: finding.slot || "none", parts: finding.parts || [] };
}
export function sectionsView(
  w: Workspace,
  orgId: string,
  roleId?: string,
): SectionsResponse {
  roleInOrg(w, orgId, roleId);
  const organisation = get(w.organisations, orgId);
  const role = roleId ? get(w.roles, roleId) : undefined;
  const gathering = (): SectionStatus => ({
    stage: "gathering",
    by: "",
    at: "",
  });
  const relevantFindings = w.findings.filter(
    (f) =>
      f.orgId === orgId &&
      f.review !== "rejected" &&
      (!roleId || !f.roleId || f.roleId === roleId),
  );
  const result = sections.map((section) => {
    const sectionSlots = slots
      .filter((slot) => slot.section === section.section)
      .map((slot) => {
        const findingIds = relevantFindings
          .filter((f) => (f.slot || "none") === slot.slot)
          .map((f) => f.id);
        return { ...slot, findingIds, filled: findingIds.length > 0 };
      });
    const sourceIds = w.sources
      .filter(
        (source) =>
          source.orgId === orgId &&
          sourceView(source).folder === section.folder &&
          (!roleId || !source.roleIds.length || source.roleIds.includes(roleId)),
      )
      .map((source) => source.id);
    const sourceTitles = sourceIds.map(
      (id) => w.sources.find((source) => source.id === id)?.title || id,
    );
    const readableSourceIds = sourceIds.filter((id) => {
      const source = w.sources.find((item) => item.id === id);
      return !!source?.text.trim() && !source.error;
    });
    const status = section.roleScoped
      ? role?.sectionStatus?.[section.section] || gathering()
      : organisation.sectionStatus?.[section.section] || gathering();
    const note = section.roleScoped
      ? role?.sectionNotes?.[section.section] || null
      : organisation.sectionNotes?.[section.section] || null;
    const unreviewed = relevantFindings.filter(
      (finding) =>
        finding.review === "unreviewed" &&
        slots.some(
          (slot) =>
            slot.section === section.section &&
            slot.slot === (finding.slot || "none"),
        ),
    ).length;
    const addedSinceExtraction =
      ["extracted", "reviewed"].includes(status.stage)
        ? w.sources.filter(
            (source) =>
              sourceIds.includes(source.id) &&
              (source.createdAt > status.at || source.updatedAt > status.at),
          ).length
        : 0;
    return {
      ...section,
      slots: sectionSlots,
      filled: sectionSlots.filter((slot) => slot.filled).length,
      total: sectionSlots.length,
      sourceIds,
      readableSourceIds,
      sourceTitles,
      gaps: sectionSlots.filter((slot) => !slot.filled).map((slot) => slot.label),
      status,
      note,
      addedSinceExtraction,
      unreviewed,
    };
  });
  return {
    sections: result,
    missing: result.flatMap((section) =>
      section.slots
        .filter((slot) => !slot.filled)
        .map((slot) => `${section.title}: ${slot.label}`),
    ),
  };
}
/**
 * Existing organisations that may be the one a user is about to create.
 * Compared by website domain and by normalised name (legal suffixes removed),
 * with the reason for each suggestion made explicit.
 */
export function suggestOrganisations(
  organisations: Organisation[],
  input: { name: string; website: string },
) {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  };
  const norm = (n: string) =>
    n
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(
        /\b(the|ltd|limited|plc|llp|llc|inc|incorporated|co|company|group|holdings|uk|gmbh|sa|ag)\b/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
  const bigrams = (s: string) => {
    const t = s.replace(/ /g, "");
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const dice = (a: string, b: string) => {
    const ba = bigrams(a);
    const bb = bigrams(b);
    let hit = 0;
    for (const [g, n] of ba) hit += Math.min(n, bb.get(g) || 0);
    const total =
      [...ba.values()].reduce((x, y) => x + y, 0) +
      [...bb.values()].reduce((x, y) => x + y, 0);
    return total ? (2 * hit) / total : 0;
  };
  const wantHost = host(input.website);
  const wantName = norm(input.name);
  const wantTokens = new Set(wantName.split(" ").filter(Boolean));
  return organisations
    .map((o) => {
      const reasons: string[] = [];
      const oHost = host(o.website);
      if (wantHost && oHost && oHost === wantHost)
        reasons.push("Same website domain");
      const oName = norm(o.name);
      if (wantName && oName) {
        const oTokens = new Set(oName.split(" ").filter(Boolean));
        const shared = [...wantTokens].filter((t) => oTokens.has(t)).length;
        const jaccard =
          shared / (new Set([...wantTokens, ...oTokens]).size || 1);
        if (oName === wantName) reasons.push("Same name");
        else if (
          (wantName.length > 3 && oName.includes(wantName)) ||
          (oName.length > 3 && wantName.includes(oName))
        )
          reasons.push("One name contains the other");
        else if (jaccard >= 0.5 && shared >= 1)
          reasons.push("Shares most name words");
        else if (wantName.length >= 5 && dice(wantName, oName) >= 0.7)
          reasons.push("Similar spelling");
      }
      return { organisation: o, reasons };
    })
    .filter((s) => s.reasons.length)
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .slice(0, 5)
    .map(({ organisation: o, reasons }) => ({
      id: o.id,
      name: o.name,
      website: o.website,
      country: o.country,
      division: o.division,
      summary: o.summary.slice(0, 240),
      reasons,
    }));
}
const packBaseSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  createdBy: text,
  reviewer: z.string(),
  status: z.enum(["draft", "ready"]),
  employerApproval: z.literal(false),
  organisation: z.object({ id: z.string().uuid(), name: text }).passthrough(),
  role: z
    .object({ id: z.string().uuid(), orgId: z.string().uuid(), title: text })
    .passthrough(),
  findings: z.array(
    z
      .object({
        id: z.string().uuid(),
        kind: z.enum(["company", "occupation", "proposal"]),
        claim: text,
        citations: z.array(citation),
        review,
      })
      .passthrough(),
  ),
  sources: z.array(
    z
      .object({
        id: z.string().uuid(),
        title: text,
        text: z.string(),
        permission: z.enum([
          "research-only",
          "awaiting-confirmation",
          "learner-approved",
        ]),
      })
      .passthrough(),
  ),
  activities: z.array(
    z.object({ id: z.string().uuid(), title: text }).passthrough(),
  ),
  questions: z.array(
    z.object({ id: z.string().uuid(), text: text }).passthrough(),
  ),
  limitations: z.array(z.string()),
});
const packV1Schema = packBaseSchema.extend({ schemaVersion: z.literal("1.0.0") });
const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const slotSchema = z.enum(["none", ...slots.map((s) => s.slot)] as [string, ...string[]]);
const partSchema = z.enum(["day", "workflow", "matters", "call"]);
const uniquePartsSchema = z
  .array(partSchema)
  .refine((parts) => new Set(parts).size === parts.length, {
    message: "Each chapter part may only be included once.",
  });
const registerRowSchema = z.object({
  n: z.number().int().positive(),
  findingId: z.string().uuid(),
  slot: slotSchema,
  tier: tierSchema,
  claim: z.string(),
  sourceIds: z.array(z.string().uuid()),
  date: z.string(),
  parts: uniquePartsSchema,
  verified: z.boolean(),
});
const packV2Schema = packBaseSchema.extend({
  schemaVersion: z.literal("2.0.0"),
  header: z.object({
    organisation: z.string(),
    entity: z.string(),
    role: z.string(),
    compiledBy: z.string(),
    started: z.string(),
    lastUpdated: z.string(),
    factChecker: z.string(),
  }),
  tiers: z.object({ 1: z.string(), 2: z.string(), 3: z.string(), 4: z.string() }),
  sections: z.array(z.object({
    section: z.enum(["organisation", "role", "case", "media", "brand", "supplied"]),
    folder: z.enum(["01-organisation", "02-role", "03-case-material", "04-media", "05-brand", "06-organisation-supplied"]),
    title: z.string(),
    note: z.object({
      text: z.string(),
      by: z.string(),
      at: z.string(),
    }).optional(),
    slots: z.array(z.object({ slot: slotSchema, label: z.string(), findingIds: z.array(z.string().uuid()) })),
  })),
  register: z.array(registerRowSchema),
  toConfirm: z.array(registerRowSchema),
});
export const packSchema = z.union([packV1Schema, packV2Schema]);
export function makePack(
  w: Workspace,
  orgId: string,
  roleId: string,
  actor: string,
  status: "draft" | "ready",
  revision: number,
  /** The compiler's display name for the document header; the actor id is used when absent. */
  actorName?: string,
  /** Dataset matches attached to this snapshot only, for schemes the role has none recorded. */
  automaticOccupations: Occupation[] = [],
): Pack {
  roleInOrg(w, orgId, roleId);
  const issues = readiness(w, orgId, roleId);
  if (
    w.jobs.some(
      (job) =>
        job.orgId === orgId &&
        (!job.roleId || job.roleId === roleId) &&
        ["queued", "researching"].includes(job.status),
    )
  )
    throw new HttpError(409, "Wait for the running extraction to finish.");
  const findings = w.findings.filter(
    (f) =>
      f.orgId === orgId &&
      (!f.roleId || f.roleId === roleId) &&
      f.review === "accepted",
  ).map((f) => {
    const view = findingView(w, f);
    return { ...view, parts: [...new Set(view.parts || [])] };
  });
  const sourceIds = new Set(
    findings.flatMap((f) => f.citations.map((c) => c.sourceId)),
  );
  const sources = w.sources
    .filter(
      (s) =>
        s.orgId === orgId &&
        (sourceIds.has(s.id) ||
          !s.roleIds.length ||
          s.roleIds.includes(roleId)),
    )
    .map(({ blob, ...rest }) => sourceView(rest));
  const organisation = get(w.organisations, orgId);
  const recorded = get(w.roles, roleId);
  const role = {
    ...recorded,
    occupations: [
      ...recorded.occupations,
      ...automaticOccupations.filter(
        (o) => !recorded.occupations.some((r) => r.scheme === o.scheme),
      ),
    ],
  };
  const sectionRows = sections.map((section) => ({
    section: section.section,
    folder: section.folder,
    title: section.title,
    ...((section.roleScoped
      ? role.sectionNotes?.[section.section]
      : organisation.sectionNotes?.[section.section])
      ? {
          note: structuredClone(
            (section.roleScoped
              ? role.sectionNotes?.[section.section]
              : organisation.sectionNotes?.[section.section])!,
          ),
        }
      : {}),
    slots: slots.filter((slot) => slot.section === section.section).map((slot) => ({
      slot: slot.slot,
      label: slot.label,
      findingIds: findings.filter((finding) => finding.slot === slot.slot).map((finding) => finding.id),
    })),
  }));
  const orderedIds = sectionRows.flatMap((section) => section.slots.flatMap((slot) => slot.findingIds));
  orderedIds.push(...findings.filter((finding) => !orderedIds.includes(finding.id)).map((finding) => finding.id));
  const register = orderedIds.map((id, index) => {
    const finding = findings.find((item) => item.id === id)!;
    const dates = finding.citations
      .map((citation) => sources.find((source) => source.id === citation.sourceId)?.retrievedAt)
      .filter(Boolean) as string[];
    return {
      n: index + 1,
      findingId: finding.id,
      slot: finding.slot || "none",
      tier: finding.tier!,
      claim: finding.claim,
      sourceIds: finding.citations.map((citation) => citation.sourceId),
      date: dates.sort().at(-1)?.slice(0, 10) || "",
      parts: [...new Set(finding.parts || [])],
      verified: !!finding.verified,
    };
  });
  const pack: PackV2 = {
    schemaVersion: "2.0.0",
    id: randomUUID(),
    revision,
    createdAt: now(),
    createdBy: actor,
    reviewer: actor,
    status: "ready",
    employerApproval: false,
    organisation,
    role,
    findings,
    sources,
    // Activity candidates were retired on 28 Oct 2026 (plan P1.3); the key
    // stays empty so the pack shape is unchanged for anything reading it.
    activities: [],
    questions: w.questions.filter(
      (q) => q.orgId === orgId && (!q.roleId || q.roleId === roleId),
    ),
    limitations: [
      ...issues,
      ...unmatchedLimitation(register, findings),
      ...sources.filter((s) => s.error).map((s) => `${s.title}: ${s.error}`),
      ...w.jobs
        .filter((j) => j.orgId === orgId && (!j.roleId || j.roleId === roleId))
        .flatMap((j) => j.errors),
    ],
    header: {
      organisation: organisation.name,
      entity: organisation.division,
      role: role.title,
      compiledBy: actorName || actor,
      started: organisation.createdAt,
      lastUpdated: now(),
      factChecker: organisation.factChecker
        ? [organisation.factChecker.name, organisation.factChecker.jobTitle].filter(Boolean).join(", ")
        : "",
    },
    tiers: tierNames,
    sections: sectionRows,
    register,
    toConfirm: register.filter((row) => row.tier > 1 && row.parts.length > 0 && !row.verified),
  };
  const parsed = packSchema.parse(pack);
  return structuredClone(parsed) as unknown as Pack;
}
/** Facts kept with a quote not found word for word, named by register number. */
function unmatchedLimitation(
  register: { n: number; findingId: string }[],
  findings: Pick<Finding, "id" | "citations">[],
): string[] {
  const flagged = new Set(
    findings
      .filter((f) => f.citations.some((c) => c.unmatched))
      .map((f) => f.id),
  );
  const numbers = register.filter((row) => flagged.has(row.findingId)).map((row) => `#${row.n}`);
  if (!numbers.length) return [];
  return [
    `${numbers.length === 1 ? "Fact" : "Facts"} ${numbers.join(", ")} ${numbers.length === 1 ? "cites a passage" : "cite passages"} not found word for word in the source. Check before relying on ${numbers.length === 1 ? "it" : "them"}.`,
  ];
}
const heading = (v: string) => v.replace(/[\r\n]/g, " ");
export function packMarkdown(p: Pack): string {
  if (p.schemaVersion === "2.0.0") return packMarkdownV2(p);
  const out = [
    `# ${heading(p.organisation.name)} — ${heading(p.role.title)}`,
    `Pack ${p.id} · Revision ${p.revision} · Schema ${p.schemaVersion}`,
    `Status: ${p.status === "ready" ? "Ready for storyboard drafting" : "Draft"}\n\nCreated: ${p.createdAt}\n\nCreated by: ${p.createdBy}\n\nReviewer: ${p.reviewer || "Not yet reviewed"}`,
    "**Research readiness is not the organisation's approval.**",
    "## Organisation",
    p.organisation.summary || "Summary not recorded.",
    `Website: ${p.organisation.website}\n\nCountry: ${p.organisation.country}\n\nDivision: ${p.organisation.division || "Not specified"}\n\nResearch lead: ${p.organisation.owner}\n\nBrand guidance: ${p.organisation.brandNotes || "Not supplied"}`,
    "## Role",
    `Location: ${p.role.location || "Not specified"}\n\nSeniority: ${p.role.seniority || "Not specified"}\n\nResponsibilities: ${p.role.responsibilities}\n\nDecision boundaries: ${p.role.boundaries || "Needs confirmation"}`,
    "## Occupational profile",
    ...p.role.occupations.map(
      (o) =>
        `### ${heading(o.scheme)} ${heading(o.code)} — ${heading(o.title)}\n\n${o.rationale}\n\nSource: ${o.sourceUrl} · Dataset: ${o.datasetVersion} · ${o.status}\n\nActivities: ${o.activities.join("; ")}\n\nSkills: ${(o.skills || []).join("; ")}\n\nKnowledge: ${(o.knowledge || []).join("; ")}\n\nWork context: ${(o.workContext || []).join("; ")}`,
    ),
    "## Fact register",
  ];
  for (const f of p.findings)
    out.push(
      `### ${heading(f.kind)} · ${f.id}\n\n${f.claim}\n\nReview: ${f.review}; reviewer: ${f.reviewer || "Pending"}; reviewed: ${f.reviewedAt || "Pending"}\n\n${f.rationale}`,
      ...f.citations.map(
        (c) =>
          `Source ${c.sourceId} — ${c.locator}\n\n> ${c.quote.replace(/\n/g, "\n> ")}`,
      ),
    );
  if (p.activities.length) out.push("## Candidate activities — proposals");
  for (const a of p.activities)
    out.push(
      `### ${heading(a.title)} · ${a.id}\n\nAction: ${a.action}\n\nOutput: ${a.output}\n\nMaterials: ${a.materials}\n\nLearning: ${a.learning}\n\nOrganisation confirmation: ${a.confirmation || "Required during storyboard review"}\n\nFact references: ${a.findingIds.join(", ")}\n\nReview: ${a.review}`,
    );
  out.push("## Sources and materials");
  for (const s of p.sources)
    out.push(
      `### ${heading(s.title)} · ${s.id}\n\nType: ${s.kind} · Permission: ${s.permission} · Verification: ${s.verification === "client-confirmed" ? "Confirmed by the organisation" : s.verification}\n\nURL: ${s.url || "Uploaded or recorded material"}\n\nRetrieved: ${s.retrievedAt} · Published: ${s.publishedAt || "Unknown"}\n\nSupplied by: ${s.suppliedBy}\n\nLocation: ${s.locator}\n\n${s.caption || ""}\n\n${s.text}`,
    );
  out.push("## Questions and organisation input");
  for (const q of p.questions)
    out.push(
      `### ${heading(q.text)} · ${q.id}\n\nWhy: ${q.why}\n\nStatus: ${q.status === "client" ? "Ask the organisation" : q.status} · Blocking: ${q.blocking ? "Yes" : "No"}\n\nAssigned to: ${q.assignee || "Unassigned"}\n\nAnswer: ${q.answer || "Unanswered"}\n\nAnswered by: ${q.answeredBy || "—"}\n\nProvenance: ${q.provenance || "Not recorded"}`,
    );
  out.push(
    "## Limitations",
    ...p.limitations.map((l) => `- ${l}`),
    "## Complete research pack metadata",
    "The JSON below preserves every field, including history and the earlier captures each web source replaced, from this same fixed research pack.",
    "```json",
    JSON.stringify(p, null, 2),
    "```",
  );
  return out.join("\n\n") + "\n";
}
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
export interface SourcesReadRow {
  source: string;
  tier: Tier;
  contribution: string;
  date: string;
}
/** Build a section's source trail from the immutable contents of a pack. */
export function sourcesReadRows(
  p: PackV2,
  section: PackV2["sections"][number],
): SourcesReadRow[] {
  const placeFor = (slot: Slot) => {
    for (const candidate of p.sections) {
      const place = candidate.slots.find((item) => item.slot === slot);
      if (place)
        return candidate.section === section.section
          ? place.label
          : `${candidate.title} · ${place.label}`;
    }
    return undefined;
  };
  return p.sources
    .map((source) => sourceView(source))
    .filter((source) => source.folder === section.folder)
    .sort(
      (a, b) =>
        a.retrievedAt.localeCompare(b.retrievedAt) ||
        a.title.localeCompare(b.title, "en-GB"),
    )
    .map((source) => {
      const places = [
        ...new Set(
          p.register
            .filter((row) => row.sourceIds.includes(source.id))
            .map((row) => placeFor(row.slot))
            .filter(Boolean) as string[],
        ),
      ];
      return {
        source: source.title,
        tier: source.tier!,
        contribution: places.join("; ") || "No facts yet",
        date: source.retrievedAt.slice(0, 10) || "—",
      };
    });
}
function packMarkdownV2(p: PackV2): string {
  const sourceNames = new Map(p.sources.map((source) => [source.id, source.title]));
  const sourceText = (ids: string[]) => ids.map((id) => sourceNames.get(id) || id).join("; ");
  const reference = (value: string, sourceId: string) =>
    `- ${value} — Source: ${sourceNames.get(sourceId) || sourceId}`;
  const rowText = (
    row: PackV2["register"][number],
    columns: NonNullable<(typeof slotFields)[Slot]>,
  ) => {
    const sources = row.sourceIds.map((id) => sourceNames.get(id) || id).join("; ");
    const finding = p.findings.find((item) => item.id === row.findingId);
    const values = columns.map((column, index) => {
      const value = finding?.fields?.[column.key];
      if (value === undefined) return index === 0 ? row.claim : "";
      return Array.isArray(value) ? value.join("; ") : String(value);
    });
    return `| ${values.map((value) => cell(value)).join(" | ")} | ${row.tier} | ${cell(sources)} | ${row.date || "—"} |`;
  };
  const out = [
    `# ${heading(p.organisation.name)} · organisation knowledge base`,
    "| Organisation | Entity | Role | Compiled by | Started | Last updated | Fact checker |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${cell(p.header.organisation)} | ${cell(p.header.entity || "—")} | ${cell(p.header.role)} | ${cell(p.header.compiledBy)} | ${p.header.started.slice(0, 10)} | ${p.header.lastUpdated.slice(0, 10)} | ${cell(p.header.factChecker || "Not yet named")} |`,
    "### Open items",
    ...(p.limitations.length ? p.limitations.map((item) => `- ${item}`) : ["None"]),
    "### How to read this",
    "| Tier | Meaning |",
    "| --- | --- |",
    ...([1, 2, 3, 4] as const).map((tier) => `| ${tier} | ${cell(p.tiers[tier])} |`),
  ];
  p.sections.forEach((section, index) => {
    out.push(`## ${index + 1}. ${section.title}`);
    if (section.note)
      out.push(
        "### Designer's note",
        section.note.text,
        `_${section.note.by} · ${section.note.at.slice(0, 10)}_`,
      );
    const sourceRows = sourcesReadRows(p, section);
    out.push("### Sources read");
    if (sourceRows.length)
      out.push(
        "| Source | Tier | What it gave us | Date read |",
        "| --- | --- | --- | --- |",
        ...sourceRows.map(
          (row) =>
            `| ${cell(row.source)} | ${row.tier} | ${cell(row.contribution)} | ${row.date} |`,
        ),
      );
    else out.push("_No sources filed in this folder._");
    if (section.section === "brand" && p.organisation.brand) {
      const brand = p.organisation.brand;
      out.push(
        "### Brand guidance",
        `Guidelines: ${brand.guidelines || "Not recorded."}\n\nLogo rules: ${brand.logo || "Not recorded."}\n\nPhotography: ${brand.photography || "Not recorded."}\n\nHouse style: ${brand.houseStyle || "Not recorded."}`,
      );
    }
    if (section.section === "supplied" && p.role.interview) {
      const interview = p.role.interview;
      out.push(
        "### Interview record",
        `Who: ${interview.who}\n\nJob title: ${interview.jobTitle}\n\nTime in role: ${interview.timeInRole || "Not recorded"}\n\nMay be named: ${interview.mayBeNamed ? "Yes" : "No"}\n\nDate: ${interview.date || "Not recorded"}\n\nHow: ${interview.how || "Not recorded"}\n\nRecording: ${interview.recordingSourceId ? sourceNames.get(interview.recordingSourceId) || interview.recordingSourceId : "Not recorded"}\n\nTranscript: ${interview.transcriptSourceId ? sourceNames.get(interview.transcriptSourceId) || interview.transcriptSourceId : "Not recorded"}`,
      );
    }
    for (const slot of section.slots) {
      out.push(`### ${slot.label}`);
      const rows = slot.findingIds.map((id) => p.register.find((row) => row.findingId === id)).filter(Boolean) as PackV2["register"];
      let referenceRendered = false;
      if (slot.slot === "role.standard" && p.role.standard) {
        const standard = p.role.standard;
        out.push(`${standard.name}\n\nLevel: ${standard.level} · Duration: ${standard.duration}\n\nStandard: ${standard.url || "Not recorded"}\n\nAssessment plan: ${standard.assessmentPlanUrl || "Not recorded"}`);
        referenceRendered = true;
      } else if (slot.slot === "role.ncs" && p.role.ncsUrl) {
        out.push(p.role.ncsUrl);
        referenceRendered = true;
      } else if (slot.slot === "role.body" && p.role.professionalBody) {
        const body = p.role.professionalBody;
        out.push(`${body.name}\n\nRegistration route: ${body.registrationRoute || "Not recorded"}\n\nFramework: ${body.frameworkUrl || "Not recorded"}`);
        referenceRendered = true;
      } else if (slot.slot === "supplied.may-use" && p.organisation.mayUse?.length) {
        out.push(...p.organisation.mayUse.map((item) => reference(item.text, item.sourceId)));
        referenceRendered = true;
      } else if (slot.slot === "supplied.must-not-say" && p.organisation.mustNotSay?.length) {
        out.push(...p.organisation.mustNotSay.map((item) => reference(item.text, item.sourceId)));
        referenceRendered = true;
      }
      if (!rows.length && !referenceRendered) out.push("_Not yet researched._");
      else if (rows.length && slots.find((item) => item.slot === slot.slot)?.table) {
        const columns = slotFields[slot.slot]!;
        out.push(
          `| ${columns.map((column) => column.label).join(" | ")} | Tier | Source | Date |`,
          `| ${[...columns.map(() => "---"), "---", "---", "---"].join(" | ")} |`,
          ...rows.map((row) => rowText(row, columns)),
        );
      } else out.push(...rows.map((row) => `${row.claim}\n\nTier ${row.tier} · ${row.sourceIds.map((id) => sourceNames.get(id) || id).join("; ") || "No source"} · ${row.date || "No date"} · ${row.parts.join(", ") || "No chapter parts"}`));
    }
  });
  const folderTitle = new Map(p.sections.map((section) => [section.folder, section.title]));
  const orderedSources = [...p.sources].sort(
    (a, b) =>
      (a.folder || "").localeCompare(b.folder || "") ||
      a.retrievedAt.localeCompare(b.retrievedAt),
  );
  const confirmationSources = orderedSources.filter(
    (source) =>
      (source.tier || 4) > 1 &&
      p.register.some((row) => row.sourceIds.includes(source.id)),
  );
  out.push(
    "## 7. Fact register",
    "| # | Fact | Tier | Source | Date | Parts | Verified |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...p.register.map((row) => `| ${row.n} | ${cell(row.claim)} | ${row.tier} | ${cell(sourceText(row.sourceIds))} | ${row.date || "—"} | ${row.parts.join(", ") || "—"} | ${row.verified ? "Yes" : "No"} |`),
    "## Sources register",
    "| Source | Folder | Tier | Permission | Date read | Facts |",
    "| --- | --- | --- | --- | --- | --- |",
    ...orderedSources.map((source) => {
      const facts = p.register.filter((row) => row.sourceIds.includes(source.id)).map((row) => row.n);
      return `| ${cell(source.title)} | ${cell(folderTitle.get(source.folder!) || source.folder || "—")} | ${source.tier || "—"} | ${cell(source.permission)} | ${source.retrievedAt.slice(0, 10) || "—"} | ${facts.join(", ") || "—"} |`;
    }),
    "## 8. Questions for the organisation",
    ...(p.questions.length ? p.questions.map((question) => `- ${question.text}${question.answer ? ` — ${question.answer}` : ""}`) : ["_No questions recorded._"]),
    "## For the organisation to confirm",
    ...(confirmationSources.length
      ? [
          "| Source | Folder | Tier | Facts | Confirmed by | Date |",
          "| --- | --- | --- | --- | --- | --- |",
          ...confirmationSources.map((source) => {
            const facts = p.register.filter((row) => row.sourceIds.includes(source.id)).map((row) => row.n);
            return `| ${cell(source.title)} | ${cell(folderTitle.get(source.folder!) || source.folder || "—")} | ${source.tier || 4} | ${facts.join(", ")} |  |  |`;
          }),
        ]
      : !p.sources.length && p.toConfirm.length
        ? p.toConfirm.map((row) => `- #${row.n} ${row.claim}`)
        : ["_Nothing awaiting confirmation._"]),
    "## Limitations",
    ...p.limitations.map((limitation) => `- ${limitation}`),
    "## Complete research pack metadata",
    "The JSON below preserves every field from this same fixed research pack.",
    "```json",
    JSON.stringify(p, null, 2),
    "```",
  );
  return `${out.join("\n\n")}\n`;
}
