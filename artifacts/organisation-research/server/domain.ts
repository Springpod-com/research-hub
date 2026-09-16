import { createHash, randomUUID } from "node:crypto";
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
  ReviewState,
} from "../shared/types.js";
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
export const roleInput = z.object({
  title: text.max(150),
  location: optionalText,
  seniority: optionalText,
  responsibilities: optionalText,
  boundaries: optionalText,
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
  claim: text,
  kind: z.enum(["company", "occupation", "proposal"]),
  roleId: z.string().uuid().optional(),
  citations: z.array(citation).max(12),
  rationale: optionalText,
});
export const questionInput = z.object({
  text: text,
  why: optionalText,
  roleId: z.string().uuid().optional(),
  blocking: z.boolean().default(false),
  assignee: optionalText,
});
export const activityInput = z.object({
  roleId: z.string().uuid(),
  title: text.max(150),
  action: text,
  output: text,
  materials: text,
  learning: text,
  confirmation: optionalText,
  findingIds: z.array(z.string().uuid()).max(30).default([]),
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
/**
 * Quotations must be verbatim, but the same words are often copied with
 * different line breaks, non-breaking spaces or typographic quotation marks
 * (the live web page versus its collapsed capture, or a PDF with wrapped
 * lines). Matching ignores only those presentational differences; the
 * wording and punctuation still have to be exact.
 */
export function normaliseQuote(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function quoteFound(sourceText: string, quote: string): boolean {
  const q = normaliseQuote(quote);
  return !!q && normaliseQuote(sourceText).includes(q);
}
const shortTitle = (s: Source) =>
  s.title.length > 80 ? `${s.title.slice(0, 77)}…` : s.title;
export function validateCitations(
  sources: Source[],
  orgId: string,
  kind: string,
  citations: Citation[],
) {
  if (kind !== "proposal" && !citations.length)
    throw new HttpError(
      422,
      "Facts about the organisation and occupational context need a supporting source passage. Choose a source and paste the exact passage, or classify the finding as a design proposal.",
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
    if (!quoteFound(s.text, c.quote))
      throw new HttpError(
        422,
        `The passage was not found in “${shortTitle(s)}”. Copy it word for word from the source’s captured text; line breaks and spacing do not matter.`,
      );
    if (kind === "company" && s.kind === "occupation")
      throw new HttpError(
        422,
        "Occupational context cannot establish a fact about the organisation.",
      );
  }
}
/**
 * A finding whose cited web page was refreshed and whose exact quotation no
 * longer appears in the new capture must be looked at again. Reviewing the
 * finding after the change (accept, exclude or clarify) clears the flag.
 */
export function needsRecheck(f: Finding): boolean {
  return (f.sourceChanges || []).some(
    (c) => !c.quoteFound && (!f.reviewedAt || f.reviewedAt < c.at),
  );
}
export function readiness(w: Workspace, orgId: string, roleId: string) {
  roleInOrg(w, orgId, roleId);
  const role = get(w.roles, roleId);
  const relevant = w.findings.filter(
    (f) => f.orgId === orgId && (!f.roleId || f.roleId === roleId),
  );
  const issues: string[] = [];
  if (!role.responsibilities.trim())
    issues.push("Describe the role responsibilities.");
  if (!relevant.some((f) => f.kind === "company" && f.review === "accepted"))
    issues.push(
      "Accept at least one evidence-backed finding about the organisation.",
    );
  if (
    relevant.some(
      (f) => f.review === "unreviewed" || f.review === "clarification",
    )
  )
    issues.push("Review outstanding findings or explicitly exclude them.");
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
  // Activity candidates are parked for now: they are kept in the data model
  // and in packs, but they neither gate readiness nor appear in the workspace.
  // An accepted activity that references evidence not accepted here still
  // blocks, so no pack can carry an activity its own findings do not support.
  for (const activity of w.activities.filter(
    (a) => a.roleId === roleId && a.review === "accepted",
  )) {
    if (
      activity.findingIds.some(
        (id) => !relevant.some((f) => f.id === id && f.review === "accepted"),
      )
    ) {
      issues.push(
        "Accepted activities must reference findings accepted in this pack.",
      );
    }
  }
  for (const f of relevant.filter((f) => f.review === "accepted"))
    try {
      validateCitations(w.sources, orgId, f.kind, f.citations);
    } catch {
      issues.push("Repair the evidence references for an accepted finding.");
    }
  if (relevant.some((f) => f.review !== "rejected" && needsRecheck(f)))
    issues.push(
      "Re-review findings whose source page changed since the quotation was captured.",
    );
  return [...new Set(issues)];
}
/**
 * Stable digest of everything a reviewer signed off when marking a role
 * profile ready. Any later change to this content returns the profile to
 * draft, so a "ready" snapshot can only be created from reviewed content.
 */
export function roleFingerprint(w: Workspace, role: Role): string {
  const org = w.organisations.find((o) => o.id === role.orgId);
  const pick = <T extends object>(o: T, keys: (keyof T)[]) =>
    Object.fromEntries(keys.map((k) => [k, o[k]]));
  const orgKeys: (keyof Organisation)[] = [
    "name",
    "website",
    "country",
    "division",
    "summary",
    "brandNotes",
    "logoSourceId",
  ];
  const findings = w.findings.filter(
    (f) => f.orgId === role.orgId && (!f.roleId || f.roleId === role.id),
  );
  const citedIds = new Set(
    findings.flatMap((f) => f.citations.map((c) => c.sourceId)),
  );
  const content = {
    role: pick(role, [
      "title",
      "location",
      "seniority",
      "responsibilities",
      "boundaries",
      "occupations",
    ]),
    organisation: org ? pick(org, orgKeys) : null,
    findings: findings.map((f) => ({
      ...pick(f, ["id", "kind", "claim", "citations", "review", "rationale"]),
      recheck: needsRecheck(f),
    })),
    // The source register a pack would snapshot, keyed by content rather than
    // id or capture time so an unchanged refresh does not disturb readiness.
    sources: [
      ...new Set(
        w.sources
          .filter(
            (s) =>
              s.orgId === role.orgId &&
              (citedIds.has(s.id) ||
                !s.roleIds.length ||
                s.roleIds.includes(role.id)),
          )
          .map((s) =>
            JSON.stringify(
              pick(s, [
                "title",
                "kind",
                "url",
                "text",
                "locator",
                "permission",
                "caption",
                "roleIds",
                "verification",
                "suppliedBy",
                "publishedAt",
                "mime",
                "filename",
                "error",
              ]),
            ),
          ),
      ),
    ].sort(),
    activities: w.activities
      .filter((a) => a.roleId === role.id)
      .map((a) =>
        pick(a, [
          "id",
          "title",
          "action",
          "output",
          "materials",
          "learning",
          "confirmation",
          "findingIds",
          "review",
        ]),
      ),
    questions: w.questions
      .filter(
        (q) => q.orgId === role.orgId && (!q.roleId || q.roleId === role.id),
      )
      .map((q) =>
        pick(q, [
          "id",
          "text",
          "why",
          "blocking",
          "status",
          "answer",
          "assignee",
        ]),
      ),
    // Research-run errors become pack limitations.
    jobErrors: w.jobs
      .filter(
        (j) => j.orgId === role.orgId && (!j.roleId || j.roleId === role.id),
      )
      .flatMap((j) => j.errors)
      .sort(),
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}
export function reviewStateOf(
  w: Workspace,
  role: Role,
): { state: ReviewState; changed: boolean } {
  const stored = role.reviewState || "draft";
  if (stored === "ready" && role.readyFingerprint !== roleFingerprint(w, role))
    return { state: "draft", changed: true };
  return { state: stored, changed: false };
}
/** Role as returned to clients: effective review state plus change flag. */
export function roleView(w: Workspace, role: Role): Role {
  const { state, changed } = reviewStateOf(w, role);
  return { ...role, reviewState: state, reviewChanged: changed };
}
export function setReviewState(
  w: Workspace,
  role: Role,
  member: Member,
  state: ReviewState,
  note: string,
) {
  const current = reviewStateOf(w, role).state;
  if (state === "ready") {
    requireRole(member, ["reviewer", "admin"]);
    const issues = readiness(w, role.orgId, role.id);
    if (issues.length) throw new HttpError(422, issues.join(" "));
    role.readyFingerprint = roleFingerprint(w, role);
  } else {
    requireRole(member, ["researcher", "reviewer", "admin"]);
    delete role.readyFingerprint;
  }
  if (current === state && role.reviewState === state)
    throw new HttpError(
      409,
      `The role profile is already ${state.replace("-", " ")}.`,
    );
  role.reviewState = state;
  role.reviewStateBy = member.userId;
  role.reviewStateAt = now();
  role.reviewStateNote = note;
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
/**
 * Sentence-level difference between two captures of the same page. Captured
 * text is whitespace-collapsed, so sentences are the smallest stable unit.
 */
export function captureDiff(before: string, after: string) {
  const sentences = (t: string) => {
    const counts = new Map<string, number>();
    for (const p of t.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9“"(])/)) {
      const v = p.trim();
      if (v.length > 1) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return counts;
  };
  const a = sentences(before);
  const b = sentences(after);
  // Sentences present more often in x than in y, repeated per extra occurrence.
  const extra = (x: Map<string, number>, y: Map<string, number>) => {
    const out: string[] = [];
    for (const [v, n] of x)
      for (let i = y.get(v) || 0; i < n && out.length < 40; i++) out.push(v);
    return out;
  };
  return { added: extra(b, a), removed: extra(a, b) };
}
/** The capture ids of one web page across refreshes, newest first. */
export function captureLineage(w: Workspace, source: Source): string[] {
  const ids: string[] = [];
  let cur: Source | undefined = source;
  while (cur && !ids.includes(cur.id)) {
    ids.push(cur.id);
    const prev: string | undefined = cur.supersedes;
    cur = prev ? w.sources.find((s) => s.id === prev) : undefined;
  }
  return ids;
}
export const packSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
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
export function makePack(
  w: Workspace,
  orgId: string,
  roleId: string,
  actor: string,
  status: "draft" | "ready",
  revision: number,
): Pack {
  roleInOrg(w, orgId, roleId);
  const issues = readiness(w, orgId, roleId);
  if (status === "ready" && issues.length)
    throw new HttpError(422, issues.join(" "));
  if (
    status === "ready" &&
    reviewStateOf(w, get(w.roles, roleId)).state !== "ready"
  )
    throw new HttpError(
      422,
      "Mark the role profile ready (after review) before creating a ready research pack. Edits made since it was marked ready return it to draft.",
    );
  const findings = w.findings.filter(
    (f) =>
      f.orgId === orgId &&
      (!f.roleId || f.roleId === roleId) &&
      f.review !== "rejected" &&
      (status === "draft" || f.review === "accepted"),
  );
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
    .map(({ blob, ...rest }) => rest);
  const pack: Pack = {
    schemaVersion: "1.0.0",
    id: randomUUID(),
    revision,
    createdAt: now(),
    createdBy: actor,
    reviewer: status === "ready" ? actor : "",
    status,
    employerApproval: false,
    organisation: get(w.organisations, orgId),
    role: roleView(w, get(w.roles, roleId)),
    findings,
    sources,
    activities: w.activities.filter(
      (a) =>
        a.roleId === roleId &&
        a.review !== "rejected" &&
        (status === "draft" || a.review === "accepted"),
    ),
    questions: w.questions.filter(
      (q) => q.orgId === orgId && (!q.roleId || q.roleId === roleId),
    ),
    limitations: [
      ...issues,
      ...sources.filter((s) => s.error).map((s) => `${s.title}: ${s.error}`),
      ...w.jobs
        .filter((j) => j.orgId === orgId && (!j.roleId || j.roleId === roleId))
        .flatMap((j) => j.errors),
      "Research readiness is not the organisation's approval. Occupational context and activity ideas require validation by the organisation.",
    ],
  };
  packSchema.parse(pack);
  return structuredClone(pack);
}
const heading = (v: string) => v.replace(/[\r\n]/g, " ");
export function packMarkdown(p: Pack): string {
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
    "## Evidence register",
  ];
  for (const f of p.findings)
    out.push(
      `### ${heading(f.kind)} · ${f.id}\n\n${f.claim}\n\nReview: ${f.review}; reviewer: ${f.reviewer || "Pending"}; reviewed: ${f.reviewedAt || "Pending"}\n\n${f.rationale}`,
      ...f.citations.map(
        (c) =>
          `Source ${c.sourceId} — ${c.locator}\n\n> ${c.quote.replace(/\n/g, "\n> ")}`,
      ),
    );
  out.push("## Candidate activities — proposals");
  for (const a of p.activities)
    out.push(
      `### ${heading(a.title)} · ${a.id}\n\nAction: ${a.action}\n\nOutput: ${a.output}\n\nMaterials: ${a.materials}\n\nLearning: ${a.learning}\n\nOrganisation confirmation: ${a.confirmation || "Required during storyboard review"}\n\nFinding references: ${a.findingIds.join(", ")}\n\nReview: ${a.review}`,
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
