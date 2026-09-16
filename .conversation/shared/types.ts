export type Review = "unreviewed" | "accepted" | "clarification" | "rejected";
export type FindingKind = "company" | "occupation" | "proposal";
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
}
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
}
export interface Role extends Base {
  orgId: string;
  title: string;
  location: string;
  seniority: string;
  responsibilities: string;
  boundaries: string;
  occupations: Occupation[];
}
export interface Source extends Base {
  orgId: string;
  roleIds: string[];
  title: string;
  kind: "web" | "document" | "statement" | "image" | "occupation";
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
  blob?: string;
  error?: string;
  caption?: string;
  runIds: string[];
}
export interface Citation {
  sourceId: string;
  quote: string;
  locator: string;
}
export interface Finding extends Base {
  orgId: string;
  roleId?: string;
  kind: FindingKind;
  claim: string;
  citations: Citation[];
  review: Review;
  rationale: string;
  reviewer?: string;
  reviewedAt?: string;
  runIds: string[];
  history: {
    at: string;
    actor: string;
    claim: string;
    review: Review;
    rationale: string;
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
  tier: "economy" | "power" | "max";
  status:
    "queued" | "researching" | "completed" | "gaps" | "failed" | "cancelled";
  stage: string;
  errors: string[];
  requestedBy: string;
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
}
export interface Audit {
  id: string;
  at: string;
  actor: string;
  action: string;
  subjectId: string;
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
  audit: Audit[];
}
export interface Pack {
  schemaVersion: "1.0.0";
  id: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  reviewer: string;
  status: "draft" | "ready";
  employerApproval: false;
  organisation: Organisation;
  role: Role;
  findings: Finding[];
  sources: Omit<Source, "blob">[];
  activities: Activity[];
  questions: Question[];
  limitations: string[];
}
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
  audit: [],
});
export const labels: Record<string, string> = {
  company: "Employer fact",
  occupation: "Occupational context",
  proposal: "Design proposal",
  unreviewed: "Needs review",
  accepted: "Accepted for drafting",
  clarification: "Needs clarification",
  rejected: "Excluded",
  open: "Open",
  client: "Ask the client",
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
};
