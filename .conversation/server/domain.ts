import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Workspace,
  Base,
  Pack,
  Member,
  Source,
  Citation,
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
  quote: text.max(3000),
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
    datasetVersion: text.max(100),
    rationale: text,
    status: z.enum(["proposed", "confirmed"]).default("proposed"),
    activities: z.array(text).max(30).default([]),
    skills: z.array(text).max(30).default([]),
    knowledge: z.array(text).max(30).default([]),
    workContext: z.array(text).max(30).default([]),
  })
  .refine(
    (o) =>
      o.scheme === "UK SOC"
        ? /^\d{4}(\d{2})?$/.test(o.code)
        : /^\d{2}-\d{4}\.\d{2}$/.test(o.code),
    "Use the dataset’s exact occupation code",
  );
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
export function validateCitations(
  sources: Source[],
  orgId: string,
  kind: string,
  citations: Citation[],
) {
  if (kind !== "proposal" && !citations.length)
    throw new HttpError(
      422,
      "Factual findings need supporting source passages.",
    );
  for (const c of citations) {
    const s = get(sources, c.sourceId);
    if (s.orgId !== orgId)
      throw new HttpError(422, "Evidence must belong to this organisation.");
    if (!s.text.includes(c.quote))
      throw new HttpError(422, "The quotation must match the source exactly.");
    if (kind === "company" && s.kind === "occupation")
      throw new HttpError(
        422,
        "Occupational context cannot establish an employer fact.",
      );
  }
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
    issues.push("Accept at least one evidence-backed employer finding.");
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
  const activities = w.activities.filter((a) => a.roleId === roleId);
  if (!activities.some((a) => a.review === "accepted"))
    issues.push("Accept at least one candidate activity.");
  if (
    activities.some((a) => ["unreviewed", "clarification"].includes(a.review))
  )
    issues.push("Review outstanding activity candidates.");
  for (const activity of activities.filter((a) => a.review === "accepted")) {
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
  return [...new Set(issues)];
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
    role: get(w.roles, roleId),
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
      "Research readiness is not employer approval. Occupational context and activity ideas require client validation.",
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
    "**Research readiness is not employer approval.**",
    "## Organisation",
    p.organisation.summary || "Summary not recorded.",
    `Website: ${p.organisation.website}\n\nCountry: ${p.organisation.country}\n\nDivision: ${p.organisation.division || "Not specified"}\n\nOwner: ${p.organisation.owner}\n\nBrand guidance: ${p.organisation.brandNotes || "Not supplied"}`,
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
      `### ${heading(a.title)} · ${a.id}\n\nAction: ${a.action}\n\nOutput: ${a.output}\n\nMaterials: ${a.materials}\n\nLearning: ${a.learning}\n\nClient confirmation: ${a.confirmation || "Required during storyboard review"}\n\nFinding references: ${a.findingIds.join(", ")}\n\nReview: ${a.review}`,
    );
  out.push("## Sources and materials");
  for (const s of p.sources)
    out.push(
      `### ${heading(s.title)} · ${s.id}\n\nType: ${s.kind} · Permission: ${s.permission} · Verification: ${s.verification}\n\nURL: ${s.url || "Uploaded or recorded material"}\n\nRetrieved: ${s.retrievedAt} · Published: ${s.publishedAt || "Unknown"}\n\nSupplied by: ${s.suppliedBy}\n\nLocation: ${s.locator}\n\n${s.caption || ""}\n\n${s.text}`,
    );
  out.push("## Questions and client input");
  for (const q of p.questions)
    out.push(
      `### ${heading(q.text)} · ${q.id}\n\nWhy: ${q.why}\n\nStatus: ${q.status} · Blocking: ${q.blocking ? "Yes" : "No"}\n\nAssigned to: ${q.assignee || "Unassigned"}\n\nAnswer: ${q.answer || "Unanswered"}\n\nAnswered by: ${q.answeredBy || "—"}\n\nProvenance: ${q.provenance || "Not recorded"}`,
    );
  out.push(
    "## Limitations",
    ...p.limitations.map((l) => `- ${l}`),
    "## Complete snapshot metadata",
    "The JSON below preserves every field, including history and source lineage, from this same immutable snapshot.",
    "```json",
    JSON.stringify(p, null, 2),
    "```",
  );
  return out.join("\n\n") + "\n";
}
