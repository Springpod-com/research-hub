import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import { clerkMiddleware, clerkClient, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Store } from "./store.js";
import {
  base,
  get,
  touch,
  audit,
  now,
  HttpError,
  orgInput,
  orgPatchInput,
  roleInput,
  rolePatchInput,
  findingInput,
  citation,
  questionInput,
  activityInput,
  occupationInput,
  optionalText,
  review,
  roleInOrg,
  validateCitations,
  readiness,
  makePack,
  packMarkdown,
  roleView,
  setReviewState,
  suggestOrganisations,
  captureDiff,
  captureLineage,
  hydrateDatasetMatch,
  sourceView,
  findingView,
  sectionsView,
  requireRole,
  structuredFinding,
  validateOrganisationReferences,
  validateRoleReferences,
} from "./domain.js";
import { buildQuotationIndex, locateQuotation } from "./quotation.js";
import {
  datasetSummaries,
  getEntry,
  search as searchOccupations,
  schemes as occupationSchemes,
} from "./occupations.js";
import type {
  Finding,
  Member,
  ResearchJob,
  SectionsResponse,
  Source,
  Workspace,
} from "../shared/types.js";
import { sectionNoteMaxLength, sections, slots } from "../shared/types.js";
import {
  providers,
  providerAccess,
  probeModel,
  promptSettings,
  DEFAULT_INSTRUCTIONS,
  OUTPUT_CONTRACT,
  CONTEXT_NOTE,
} from "./research.js";
import {
  SLOTS,
  CATALOGUE,
  PROVIDER_LABEL,
  MODEL_ID,
  providerOf,
  resolveModel,
  slotProblem,
  settingsOf,
} from "./models.js";
import { fetchPublic, extractPage } from "./retrieval.js";
import { allowedOrigins } from "./origins.js";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./clerk-proxy.js";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  confirmationMarkdown,
  packDocx,
  packFolderZipStream,
  packZipName,
} from "./export.js";
export interface AppOptions {
  testMember?: Member;
  preview?: boolean;
  serveFrontend?: boolean;
}
const csv = (value: string | undefined) =>
  (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const folderField = z.enum([
  "01-organisation",
  "02-role",
  "03-case-material",
  "04-media",
  "05-brand",
  "06-organisation-supplied",
]);
const tierField = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
const rightsField = z.enum([
  "organisation-supplied",
  "press-kit",
  "reference-only",
]);
const providedByField = z.object({
  name: z.string().trim().min(1).max(200),
  jobTitle: z.string().trim().max(200),
});
const sourceKnowledgeShape = {
  folder: z.union([folderField, z.null()]).optional(),
  tier: z.union([tierField, z.null()]).optional(),
  tierReason: z.string().trim().max(2000).optional(),
  rights: z.union([rightsField, z.null()]).optional(),
  transcriptSourceId: z.union([z.string().uuid(), z.null()]).optional(),
  timecode: z.union([z.string().trim().max(100), z.null()]).optional(),
  providedBy: providedByField.nullable().optional(),
};
const requireTierReason = (data: {
  tier?: 1 | 2 | 3 | 4 | null;
  tierReason?: string;
}) => {
  if (data.tier !== undefined && data.tier !== null && !data.tierReason?.trim())
    throw new HttpError(
      422,
      "Explain why this source has a manually assigned tier.",
    );
};
/**
 * The initial administrator is identified by Clerk user ID
 * (BOOTSTRAP_ADMIN_IDS) or, because Clerk's development and production
 * instances issue different IDs for the same person, by the verified primary
 * email address of the Clerk account (BOOTSTRAP_ADMIN_EMAILS). Every later
 * member is added in the app by an administrator.
 */
async function isBootstrapAdmin(userId: string) {
  if (csv(process.env.BOOTSTRAP_ADMIN_IDS).includes(userId)) return true;
  const emails = csv(process.env.BOOTSTRAP_ADMIN_EMAILS).map((e) =>
    e.toLowerCase(),
  );
  if (!emails.length) return false;
  const user = await clerkClient.users.getUser(userId);
  const primary = user.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId,
  );
  return (
    !!primary &&
    primary.verification?.status === "verified" &&
    emails.includes(primary.emailAddress.toLowerCase())
  );
}
export function createApp(store: Store, options: AppOptions = {}) {
  if (
    process.env.NODE_ENV === "production" &&
    (options.testMember || options.preview)
  )
    throw new Error("Test/preview authentication is forbidden in production.");
  const app = express();
  app.disable("x-powered-by");
  // The app always sits one hop behind a Replit proxy (the deployment edge in
  // production, the workspace proxy and Vite in development), which sets
  // X-Forwarded-For. Trusting that hop lets the rate limiter key on the real
  // client instead of pooling every user into the proxy's single bucket.
  app.set("trust proxy", 1);
  // Replit-managed Clerk: in production the Clerk Frontend API is served from
  // this origin under /api/__clerk (no CNAME needed). The proxy streams raw
  // bytes, so it is mounted before rate limiting and body parsing; it is a
  // no-op outside production or when CLERK_PROXY_DISABLED=true (own Clerk
  // application with its own domain).
  const clerkProxy =
    process.env.CLERK_PROXY_DISABLED !== "true" &&
    process.env.NODE_ENV === "production" &&
    !!process.env.CLERK_SECRET_KEY;
  if (clerkProxy) app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
  );
  // Reads are polled by every open tab (two requests every few seconds while
  // a research run is active) and a team often shares one office address, so
  // they get their own, larger budget; writes keep the tighter one.
  const isRead = (req: Request) => ["GET", "HEAD"].includes(req.method);
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 900,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => !isRead(req),
      message: { error: "Too many requests from this network; wait a minute." },
    }),
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false,
      skip: isRead,
      message: { error: "Too many changes at once; wait a minute." },
    }),
  );
  app.use(express.json({ limit: "500kb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/config", (_req, res) =>
    res.json({
      clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || "",
      clerkProxyPath: clerkProxy ? CLERK_PROXY_PATH : "",
      configured:
        !!process.env.CLERK_SECRET_KEY && !!process.env.CLERK_PUBLISHABLE_KEY,
      preview: !!options.preview,
    }),
  );
  if (
    !options.testMember &&
    process.env.CLERK_SECRET_KEY &&
    process.env.CLERK_PUBLISHABLE_KEY
  )
    app.use(
      "/api",
      clerkMiddleware((req) => ({
        // Resolve the key from the request host so custom Clerk domains keep
        // working; falls back to CLERK_PUBLISHABLE_KEY.
        publishableKey: publishableKeyFromHost(
          getClerkProxyHost(req) ?? "",
          process.env.CLERK_PUBLISHABLE_KEY,
        ),
        authorizedParties: allowedOrigins(),
      })),
    );
  const handler =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res, next) => {
      void fn(req, res).catch(next);
    };
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin
      ) {
        if (!allowedOrigins().includes(req.headers.origin))
          throw new HttpError(403, "Request origin is not allowed.");
      }
      if (options.testMember) {
        res.locals.member = options.testMember;
        return;
      }
      if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY)
        throw new HttpError(
          503,
          "Clerk is not configured. Ask your administrator to complete setup.",
        );
      const auth = getAuth(req);
      if (!auth.userId) throw new HttpError(401, "Sign in to your workspace.");
      let member = (await store.read()).members.find(
        (m) => m.userId === auth.userId,
      );
      if (!member && (await isBootstrapAdmin(auth.userId))) {
        member = await store.transact((w) => {
          const existing = w.members.find((m) => m.userId === auth.userId);
          if (existing) return existing;
          const item: Member = {
            userId: auth.userId!,
            name: "Workspace administrator",
            role: "admin",
            active: true,
          };
          w.members.push(item);
          audit(
            w,
            auth.userId!,
            "Initial administrator provisioned",
            auth.userId!,
          );
          return item;
        });
      }
      if (!member?.active)
        throw new HttpError(
          403,
          "Your account does not have access to this research workspace. Contact an administrator.",
        );
      res.locals.member = member;
    })().then(() => next(), next);
  });
  const mutate = (
    req: Request,
    res: Response,
    fn: (w: Workspace, m: Member, db: any) => any,
    admin = false,
  ) =>
    store.transact((w, db) => {
      const m = res.locals.member as Member;
      const current =
        options.testMember || w.members.find((x) => x.userId === m.userId);
      if (!current?.active)
        throw new HttpError(403, "Workspace access has been revoked.");
      if (admin && current.role !== "admin")
        throw new HttpError(403, "Administrator access required.");
      return fn(w, current, db);
    });
  const reviewFinding = (
    w: Workspace,
    m: Member,
    finding: Finding,
    changes: Partial<
      Pick<Finding, "claim" | "kind" | "citations" | "review" | "rationale" | "slot" | "parts" | "fields">
    >,
    expectedVersion: unknown,
    withoutVersion = false,
  ) => {
    const kind = changes.kind ?? finding.kind;
    const citations = changes.citations ?? finding.citations;
    const slot = changes.slot ?? finding.slot;
    const fields = changes.fields ?? finding.fields;
    structuredFinding(
      w.sources,
      finding.orgId,
      slot,
      fields,
      citations,
      w,
    );
    const inventedMeasurement =
      slot === "case.measurement" &&
      fields?.origin === "invented and declared";
    if (!inventedMeasurement)
      validateCitations(w.sources, finding.orgId, kind, citations);
    if (withoutVersion) {
      finding.version++;
      finding.updatedAt = now();
    } else {
      touch(finding, expectedVersion);
    }
    const at = now();
    finding.history.push({
      at,
      actor: m.userId,
      claim: finding.claim,
      review: finding.review,
      rationale: finding.rationale,
      verified: finding.verified
        ? structuredClone(finding.verified)
        : undefined,
    });
    Object.assign(finding, changes, {
      reviewer: m.userId,
      reviewedAt: at,
    });
    audit(w, m.userId, "Fact reviewed", finding.id);
    return finding;
  };
  app.get(
    "/api/session",
    handler(async (_req, res) =>
      res.json({
        ...res.locals.member,
        demo: !!options.preview,
        providers: providers(await store.read()),
      }),
    ),
  );
  app.get(
    "/api/workspace",
    handler(async (req, res) => {
      // Every open tab polls this. A tab that already holds the current
      // revision is told so before the document is read; the browser then
      // hands the client its cached copy, and the client sees the unchanged
      // tag and leaves the screen alone. The tag also names who the copy was
      // made for: the browser's cache is shared by everyone who signs in on
      // it, and an administrator's copy (full member records) must never be
      // handed to the next person's poll as "unchanged".
      const m = res.locals.member as { userId: string; role: string };
      const etag = store.etag.replace(/"$/, `-${m.role}-${m.userId}"`);
      res.setHeader("Cache-Control", "private, no-cache");
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }
      const w = await store.read();
      res.json({
        ...w,
        roles: w.roles.map((r) => roleView(w, r)),
        sources: w.sources.map(({ blob, ...s }) => sourceView(s)),
        findings: w.findings.map((f) => findingView(w, f)),
        members:
          res.locals.member.role === "admin"
            ? w.members
            : w.members.map(({ name, userId }) => ({ name, userId })),
        packs: await store.packs(),
      });
    }),
  );
  app.get(
    "/api/organisations/suggest",
    handler(async (req, res) => {
      const q = z
        .object({
          name: z.string().trim().max(150).default(""),
          website: z.string().trim().max(500).default(""),
        })
        .parse(req.query);
      const w = await store.read();
      res.json({ suggestions: suggestOrganisations(w.organisations, q) });
    }),
  );
  app.post(
    "/api/organisations",
    handler(async (req, res) => {
      const data = orgInput.parse(req.body);
      const result = await mutate(req, res, (w, m) => {
        const same = w.organisations.find(
          (o) =>
            (o.name.toLowerCase() === data.name.toLowerCase() ||
              (o.website &&
                data.website &&
                new URL(o.website).hostname ===
                  new URL(data.website).hostname)) &&
            o.division.toLowerCase() === data.division.toLowerCase(),
        );
        if (same)
          throw new HttpError(
            409,
            `An organisation already exists: ${same.name}. Open its record or specify a different division.`,
          );
        const org = { ...base(), ...data, owner: m.name };
        w.organisations.push(org);
        audit(w, m.userId, "Organisation created", org.id);
        return org;
      });
      res.status(201).json(result);
    }),
  );
  app.patch(
    "/api/organisations/:id",
    handler(async (req, res) => {
      const data = orgPatchInput.parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const item = get(w.organisations, String(req.params.id));
          validateOrganisationReferences(w.sources, item.id, data.mayUse);
          validateOrganisationReferences(w.sources, item.id, data.mustNotSay);
          touch(item, req.body.version);
          const { factChecker, brand, mayUse, mustNotSay, ...changes } = data;
          Object.assign(item, changes);
          for (const [key, value] of Object.entries({ factChecker, brand, mayUse, mustNotSay }))
            if (value === null) delete (item as unknown as Record<string, unknown>)[key];
            else if (value !== undefined) (item as unknown as Record<string, unknown>)[key] = value;
          audit(
            w,
            m.userId,
            "Organisation updated; existing research packs unchanged",
            item.id,
          );
          return item;
        }),
      );
    }),
  );
  app.post(
    "/api/organisations/:id/roles",
    handler(async (req, res) => {
      const data = roleInput.parse(req.body);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          get(w.organisations, String(req.params.id));
          const role = {
            ...base(),
            ...data,
            orgId: String(req.params.id),
            occupations: [],
          };
          w.roles.push(role);
          audit(w, m.userId, "Role created", role.id);
          return role;
        }),
      );
    }),
  );
  app.patch(
    "/api/roles/:id",
    handler(async (req, res) => {
      const data = rolePatchInput.parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const role = get(w.roles, String(req.params.id));
          validateRoleReferences(w.sources, role.orgId, data.interview);
          touch(role, req.body.version);
          const { standard, ncsUrl, professionalBody, interview, ...changes } = data;
          Object.assign(role, changes);
          for (const [key, value] of Object.entries({ standard, ncsUrl, professionalBody, interview }))
            if (value === null) delete (role as unknown as Record<string, unknown>)[key];
            else if (value !== undefined) (role as unknown as Record<string, unknown>)[key] = value;
          audit(w, m.userId, "Role updated", role.id);
          return role;
        }),
      );
    }),
  );
  app.delete(
    "/api/roles/:id",
    handler(async (req, res) => {
      res.json(
        await mutate(req, res, async (w, m, db) => {
          if (!["reviewer", "admin"].includes(m.role))
            throw new HttpError(
              403,
              "Only reviewers and administrators can delete a role.",
            );
          const role = get(w.roles, String(req.params.id));
          if (req.body?.version !== role.version)
            throw new HttpError(
              409,
              "This role changed. Refresh it before deleting.",
            );
          // Packs are immutable delivery records; a role that has been
          // exported stays so that its snapshots keep a live parent.
          const packs = await db.query(
            "SELECT COUNT(*) AS n FROM research_packs WHERE role_id=$1",
            [role.id],
          );
          const packCount = Number(packs.rows[0].n);
          if (packCount)
            throw new HttpError(
              409,
              `This role has ${packCount} research pack${packCount === 1 ? "" : "s"}. Packs are immutable records, so a role that has been exported cannot be deleted.`,
            );
          if (
            w.jobs.some(
              (j) =>
                j.roleId === role.id &&
                ["queued", "researching"].includes(j.status),
            )
          )
            throw new HttpError(
              409,
              "A research run is in progress for this role. Cancel it before deleting the role.",
            );
          const scoped = <T extends { roleId?: string }>(items: T[]) =>
            items.filter((x) => x.roleId === role.id).length;
          const deleted = {
            findings: scoped(w.findings),
            questions: scoped(w.questions),
            activities: scoped(w.activities),
            jobs: scoped(w.jobs),
          };
          // Sources stay with the organisation, but their provenance must not
          // point at research runs or flagged findings that no longer exist.
          const gone = new Set(
            [...w.findings, ...w.jobs]
              .filter((x) => x.roleId === role.id)
              .map((x) => x.id),
          );
          let sourcesUnlinked = 0;
          for (const s of w.sources) {
            if (s.roleIds.includes(role.id)) {
              s.roleIds = s.roleIds.filter((id) => id !== role.id);
              sourcesUnlinked++;
            }
            s.runIds = s.runIds.filter((id) => !gone.has(id));
            if (s.captureDiff)
              s.captureDiff.affectedFindingIds =
                s.captureDiff.affectedFindingIds.filter((id) => !gone.has(id));
          }
          w.findings = w.findings.filter((f) => f.roleId !== role.id);
          w.questions = w.questions.filter((q) => q.roleId !== role.id);
          w.activities = w.activities.filter((a) => a.roleId !== role.id);
          w.jobs = w.jobs.filter((j) => j.roleId !== role.id);
          w.roles = w.roles.filter((r) => r.id !== role.id);
          audit(
            w,
            m.userId,
            `Role “${role.title}” deleted with ${deleted.findings} role-scoped facts, ${deleted.questions} questions, ${deleted.activities} activities and ${deleted.jobs} research runs; ${sourcesUnlinked} sources kept for the organisation`,
            role.id,
          );
          return { id: role.id, deleted, sourcesUnlinked };
        }),
      );
    }),
  );
  app.post(
    "/api/roles/:id/review-state",
    handler(async (req, res) => {
      const data = z
        .object({
          state: z.enum(["draft", "in-review", "ready"]),
          note: z.string().trim().max(2000).default(""),
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const role = get(w.roles, String(req.params.id));
          touch(role, req.body.version);
          setReviewState(w, role, m, data.state, data.note);
          audit(
            w,
            m.userId,
            `Role profile ${data.state === "in-review" ? "sent for review" : data.state === "ready" ? "marked ready" : "returned to draft"}`,
            role.id,
          );
          return roleView(w, role);
        }),
      );
    }),
  );
  // Official occupational reference data (bundled UK SOC 2020 and O*NET).
  app.get(
    "/api/occupations/datasets",
    handler(async (_req, res) =>
      res.json({ datasets: await datasetSummaries() }),
    ),
  );
  app.get(
    "/api/occupations/search",
    handler(async (req, res) => {
      const q = z
        .object({
          q: z.string().trim().min(2).max(300),
          scheme: z.enum(["UK SOC", "O*NET"]).optional(),
          limit: z.coerce.number().int().min(1).max(20).default(8),
        })
        .parse(req.query);
      const candidates: Record<string, unknown[]> = {};
      for (const scheme of q.scheme ? [q.scheme] : occupationSchemes)
        candidates[scheme] = await searchOccupations(
          scheme,
          { title: q.q },
          q.limit,
        );
      res.json({ candidates });
    }),
  );
  app.get(
    "/api/occupations/entry",
    handler(async (req, res) => {
      const q = z
        .object({
          scheme: z.enum(["UK SOC", "O*NET"]),
          code: z.string().trim().min(1).max(30),
        })
        .parse(req.query);
      res.json(await getEntry(q.scheme, q.code));
    }),
  );
  app.get(
    "/api/roles/:id/occupation-candidates",
    handler(async (req, res) => {
      const w = await store.read();
      const role = get(w.roles, String(req.params.id));
      const query = {
        title: role.title,
        context: role.responsibilities,
        seniority: role.seniority,
      };
      const candidates: Record<string, unknown[]> = {};
      for (const scheme of occupationSchemes)
        candidates[scheme] = await searchOccupations(scheme, query, 6);
      res.json({ query, candidates, datasets: await datasetSummaries() });
    }),
  );
  app.post(
    "/api/roles/:id/occupations",
    handler(async (req, res) => {
      let data = occupationInput.parse(req.body);
      data.jurisdiction ||= data.scheme === "UK SOC" ? "UK" : "US";
      if (data.basis === "dataset-search") {
        const found = await getEntry(data.scheme, data.code).catch(() => {
          throw new HttpError(
            422,
            "That occupation code is not in the bundled dataset.",
          );
        });
        data = hydrateDatasetMatch(data, found);
      }
      res.json(
        await mutate(req, res, (w, m) => {
          const role = get(w.roles, String(req.params.id));
          if (
            role.occupations.some(
              (o) => o.scheme === data.scheme && o.code === data.code,
            )
          )
            throw new HttpError(
              409,
              "This occupation is already recorded for the role.",
            );
          touch(role, req.body.version);
          role.occupations.push(data);
          audit(
            w,
            m.userId,
            `Occupational match recorded (${data.basis === "dataset-search" ? "dataset search" : "manual"})`,
            role.id,
          );
          return role;
        }),
      );
    }),
  );
  app.post(
    "/api/roles/:id/occupations/status",
    handler(async (req, res) => {
      const body = z
        .object({
          scheme: z.enum(["UK SOC", "O*NET"]),
          code: z.string().trim().min(1).max(30),
          status: z.enum(["proposed", "confirmed"]),
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const role = get(w.roles, String(req.params.id));
          const match = role.occupations.find(
            (o) => o.scheme === body.scheme && o.code === body.code,
          );
          if (!match) throw new HttpError(404, "Occupational match not found.");
          touch(role, req.body.version);
          match.status = body.status;
          audit(
            w,
            m.userId,
            `Occupational match ${body.scheme} ${body.code} ${body.status === "confirmed" ? "confirmed" : "returned to proposed"}`,
            role.id,
          );
          return role;
        }),
      );
    }),
  );
  app.post(
    "/api/organisations/:id/sources",
    handler(async (req, res) => {
      const data = z
        .object({
          title: z.string().trim().min(1).max(200),
          text: z.string().min(1).max(200000),
          kind: z.enum([
            "statement",
            "occupation",
            "document",
            "film",
            "advert",
            "screenshot",
            "standard",
            "guidance",
            "note",
          ]),
          extractedFrom: z.string().trim().max(2000).optional(),
          url: z.string().default(""),
          roleIds: z.array(z.string().uuid()).default([]),
          permission: z
            .enum([
              "research-only",
              "awaiting-confirmation",
              "learner-approved",
            ])
            .default("research-only"),
          suppliedBy: z.string().min(1).max(200),
          verification: z
            .enum(["user-supplied", "client-confirmed", "public-source"])
            .default("user-supplied"),
          publishedAt: optionalText,
          locator: optionalText,
          ...sourceKnowledgeShape,
          folder: folderField.optional(),
          tier: tierField.optional(),
          rights: rightsField.optional(),
          transcriptSourceId: z.string().uuid().optional(),
          timecode: z.string().trim().max(100).optional(),
          providedBy: providedByField.optional(),
        })
        .superRefine((value, context) => {
          if (value.kind === "note" && !value.extractedFrom)
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["extractedFrom"],
              message: "Record where this note was extracted from.",
            });
          if (value.kind !== "note" && value.text.length > 100000)
            context.addIssue({
              code: z.ZodIssueCode.too_big,
              maximum: 100000,
              inclusive: true,
              origin: "string",
              path: ["text"],
              message: "Text must contain at most 100000 characters.",
            });
        })
        .parse(req.body);
      if (data.kind === "note") {
        data.folder ||= "01-organisation";
        data.tier ??= 2;
        data.tierReason ||=
          `Team note; extracted from ${data.extractedFrom}`;
      }
      requireTierReason(data);
      if (data.url && !/^https?:\/\//.test(data.url))
        throw new HttpError(422, "Use a HTTP(S) source URL.");
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const orgId = String(req.params.id);
          roleInOrg(w, orgId);
          data.roleIds.forEach((id) => roleInOrg(w, orgId, id));
          const source: Source = {
            ...base(),
            ...data,
            orgId,
            retrievedAt: now(),
            runIds: [],
          };
          w.sources.push(source);
          audit(w, m.userId, "Source recorded", source.id);
          return sourceView(source);
        }),
      );
    }),
  );
  app.post(
    "/api/organisations/:id/web-source",
    handler(async (req, res) => {
      const data = z
        .object({
          url: z.string().url(),
          roleId: z.string().uuid().optional(),
          folder: folderField.optional(),
          rights: rightsField.optional(),
          providedBy: providedByField.optional(),
          tier: tierField.optional(),
          tierReason: z.string().trim().max(2000).optional(),
        })
        .parse(req.body);
      requireTierReason(data);
      roleInOrg(await store.read(), String(req.params.id), data.roleId);
      const page = await fetchPublic(data.url);
      const p = extractPage(page.html, page.url);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const source: Source = {
            ...base(),
            orgId: String(req.params.id),
            roleIds: data.roleId ? [data.roleId] : [],
            title: p.title,
            text: p.text,
            url: page.url,
            kind: "web",
            permission: "research-only",
            suppliedBy: "Public website",
            verification: "public-source",
            publishedAt: "",
            retrievedAt: now(),
            locator: "Captured page excerpt",
            runIds: [],
            folder: data.folder,
            rights: data.rights,
            providedBy: data.providedBy,
            tier: data.tier,
            tierReason: data.tierReason,
          };
          w.sources.push(source);
          audit(w, m.userId, "Public page captured", source.id);
          return sourceView(source);
        }),
      );
    }),
  );
  app.post(
    "/api/sources/:id/refresh",
    handler(async (req, res) => {
      const current = get((await store.read()).sources, String(req.params.id));
      if (current.kind !== "web" || !current.url)
        throw new HttpError(422, "Only captured web pages can be refreshed.");
      if (current.supersededBy)
        throw new HttpError(
          409,
          "This capture was already refreshed. Refresh the latest capture instead.",
        );
      const page = await fetchPublic(current.url);
      const p = extractPage(page.html, page.url);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const previous = get(w.sources, current.id);
          if (previous.supersededBy)
            throw new HttpError(409, "This capture was already refreshed.");
          const source: Source = {
            ...base(),
            orgId: previous.orgId,
            roleIds: [...previous.roleIds],
            title: p.title,
            text: p.text,
            url: page.url,
            kind: "web",
            permission: previous.permission,
            suppliedBy: "Public website",
            verification: "public-source",
            publishedAt: "",
            retrievedAt: now(),
            locator: "Captured page excerpt",
            runIds: [],
            supersedes: previous.id,
            folder: previous.folder,
            tier: previous.tier,
            tierReason: previous.tierReason,
            rights: previous.rights,
            transcriptSourceId: previous.transcriptSourceId,
            timecode: previous.timecode,
            providedBy: previous.providedBy
              ? { ...previous.providedBy }
              : undefined,
          };
          // Findings cite whichever capture of this page they were made
          // against, so every earlier capture in the lineage is checked.
          const lineage = new Set(captureLineage(w, previous));
          previous.supersededBy = source.id;
          previous.version++;
          previous.updatedAt = now();
          w.sources.push(source);
          const at = source.retrievedAt;
          const affected: string[] = [];
          const refreshedQuotationIndex = buildQuotationIndex(p.text);
          const previousQuotationIndex = buildQuotationIndex(previous.text);
          for (const f of w.findings) {
            const cited = f.citations.filter((c) => lineage.has(c.sourceId));
            if (!cited.length) continue;
            const quoteFound = cited.every(
              (c) => locateQuotation(refreshedQuotationIndex, c.quote) !== null,
            );
            // Each quotation is judged on its own: one that was still in the
            // last capture and is gone now is a new disappearance, however
            // many others were already missing (and flagged) before.
            const newlyMissing = cited.some(
              (c) =>
                locateQuotation(previousQuotationIndex, c.quote) !== null &&
                locateQuotation(refreshedQuotationIndex, c.quote) === null,
            );
            if (!quoteFound && !newlyMissing) continue;
            f.sourceChanges = [
              ...(f.sourceChanges || []),
              { at, sourceId: previous.id, newSourceId: source.id, quoteFound },
            ];
            // Bump so a review panel opened before the refresh cannot save
            // over the change without seeing it (stale saves get 409).
            f.version++;
            f.updatedAt = at;
            if (!quoteFound) affected.push(f.id);
          }
          const changed = previous.text !== p.text;
          source.captureDiff = {
            previousId: previous.id,
            changed,
            ...captureDiff(previous.text, p.text),
            affectedFindingIds: affected,
          };
          audit(
            w,
            m.userId,
            changed
              ? `Source refreshed; ${affected.length} fact(s) need re-review`
              : "Source refreshed; no text change",
            source.id,
          );
          return { source: sourceView(source), ...source.captureDiff };
        }),
      );
    }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
  });
  app.post(
    "/api/organisations/:id/upload",
    upload.single("file"),
    handler(async (req, res) => {
      const f = req.file;
      if (!f) throw new HttpError(422, "Choose a file.");
      const orgId = String(req.params.id);
      const roleId = req.body.roleId || undefined;
      roleInOrg(await store.read(), orgId, roleId);
      const uploadKnowledge = z
        .object({
          folder: z.preprocess(
            (value) => value || undefined,
            folderField.optional(),
          ),
          rights: z.preprocess(
            (value) => value || undefined,
            rightsField.optional(),
          ),
          tier: z.preprocess(
            (value) =>
              value === undefined || value === "" ? undefined : Number(value),
            tierField.optional(),
          ),
          tierReason: z.preprocess(
            (value) => value || undefined,
            z.string().trim().max(2000).optional(),
          ),
          providedBy: z.preprocess((value) => {
            if (!value) return undefined;
            if (typeof value !== "string") return value;
            try {
              return JSON.parse(value);
            } catch {
              return value;
            }
          }, providedByField.optional()),
        })
        .parse(req.body);
      requireTierReason(uploadKnowledge);
      const ext = path.extname(f.originalname).toLowerCase();
      const textTypes: Record<string, string> = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
      };
      const allowed = [
        ...Object.keys(textTypes),
        ".pdf",
        ".docx",
        ".png",
        ".jpg",
        ".jpeg",
      ];
      if (!allowed.includes(ext))
        throw new HttpError(
          422,
          "Use PDF, DOCX, TXT, Markdown, PNG or JPEG, up to 10 MB.",
        );
      if (process.env.UPLOAD_SCAN_COMMAND) {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.env.UPLOAD_SCAN_COMMAND!,
            ["--no-summary", "-"],
            { stdio: ["pipe", "ignore", "ignore"] },
          );
          const timer = setTimeout(() => {
            child.kill();
            reject(new HttpError(503, "File scanning timed out."));
          }, 30000);
          child.on("error", () => {
            clearTimeout(timer);
            reject(new HttpError(503, "File scanner unavailable."));
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            // clamscan/clamdscan convention: 0 clean, 1 threat found, other
            // codes are scanner errors (for example the daemon is not running).
            if (code === 0) resolve();
            else if (code === 1)
              reject(new HttpError(422, "File did not pass the upload scan."));
            else reject(new HttpError(503, "File scanner unavailable."));
          });
          child.stdin.on("error", () => {});
          child.stdin.end(f.buffer);
        });
      } else if (process.env.NODE_ENV === "production")
        throw new HttpError(
          503,
          "An upload scanner must be configured before production file uploads.",
        );
      let content = "";
      let locator = "Document text";
      let mime = "text/plain";
      let image = false;
      if (ext === ".pdf") {
        if (f.buffer.subarray(0, 5).toString() !== "%PDF-")
          throw new HttpError(422, "This file is not a valid PDF.");
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: f.buffer });
        try {
          const result = await parser.getText();
          content = result.pages
            .map((p: any) => `[Page ${p.num}]\n${p.text}`)
            .join("\n\n");
          locator = "Page markers in source text";
        } finally {
          await parser.destroy();
        }
        mime = "application/pdf";
      } else if (ext === ".docx") {
        if (f.buffer.subarray(0, 2).toString() !== "PK")
          throw new HttpError(422, "This file is not a valid DOCX.");
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(f.buffer);
        const expanded = Object.values(zip.files).reduce(
          (n, x) => n + ((x as any)._data?.uncompressedSize || 0),
          0,
        );
        if (expanded > 30_000_000)
          throw new HttpError(
            422,
            "Expanded document exceeds the processing limit.",
          );
        const mammoth = await import("mammoth");
        content = (await mammoth.extractRawText({ buffer: f.buffer })).value;
        mime =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        locator = "Document paragraphs";
      } else if (textTypes[ext]) {
        if (f.buffer.includes(0))
          throw new HttpError(422, "Binary files cannot be uploaded as text.");
        content = f.buffer.toString("utf8");
        mime = textTypes[ext];
      } else {
        image = true;
        const png = f.buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpg =
          f.buffer[0] === 255 && f.buffer[1] === 216 && f.buffer[2] === 255;
        if (!png && !jpg)
          throw new HttpError(
            422,
            "Image signature does not match PNG or JPEG.",
          );
        mime = png ? "image/png" : "image/jpeg";
        locator = "Workplace reference image";
      }
      const source: Source = {
        ...base(),
        orgId,
        roleIds: roleId ? [roleId] : [],
        title: req.body.title?.slice(0, 200) || f.originalname,
        kind: image ? "image" : "document",
        url: "",
        text: content.slice(0, 100000),
        locator,
        permission: "awaiting-confirmation",
        verification: "user-supplied",
        suppliedBy: res.locals.member.name,
        publishedAt: "",
        retrievedAt: now(),
        filename: f.originalname,
        mime,
        caption: String(req.body.caption || "").slice(0, 4000),
        runIds: [],
        ...uploadKnowledge,
        error:
          !image && !content.trim()
            ? "No extractable text. Upload a text-readable document or record a passage manually."
            : undefined,
      };
      await mutate(req, res, async (w, m, db) => {
        // The file itself is kept beside the workspace, not inside it, in the
        // same transaction as the source record.
        await Store.putFile(
          db,
          source.id,
          f.buffer,
          !!process.env.UPLOAD_SCAN_COMMAND,
        );
        w.sources.push(source);
        audit(w, m.userId, "Source uploaded", source.id);
      });
      res.status(201).json(sourceView(source));
    }),
  );
  app.get(
    "/api/sources/:id/file",
    handler(async (req, res) => {
      const s = get((await store.read()).sources, String(req.params.id));
      const data = await store.file(s.id);
      if (!data) throw new HttpError(404, "No uploaded file.");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", s.mime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(s.filename || "source").replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      );
      res.send(data);
    }),
  );
  app.put(
    "/api/orgs/:orgId/sections/:section/status",
    handler(async (req, res) => {
      const section = sections.find(
        (item) => item.section === String(req.params.section),
      );
      if (!section) throw new HttpError(404, "Section not found.");
      const data = z
        .object({
          stage: z.enum(["gathering", "complete", "reviewed"]),
          roleId: z.string().uuid().optional(),
        })
        .parse(req.body);
      if (section.roleScoped && !data.roleId)
        throw new HttpError(422, "A role is required for this section.");
      if (!section.roleScoped && data.roleId)
        throw new HttpError(
          422,
          "A role is not allowed for an organisation-wide section.",
        );
      res.json(
        await mutate(req, res, (w, member) => {
          const orgId = String(req.params.orgId);
          roleInOrg(w, orgId, data.roleId);
          const summary = sectionsView(w, orgId, data.roleId).sections.find(
            (item) => item.section === section.section,
          )!;
          if (
            data.stage === "reviewed" &&
            !["reviewer", "admin"].includes(member.role)
          )
            throw new HttpError(
              403,
              "A reviewer or administrator must mark a folder reviewed.",
            );
          if (data.stage === "reviewed" && summary.unreviewed)
            throw new HttpError(
              422,
              `This folder has ${summary.unreviewed} unreviewed ${summary.unreviewed === 1 ? "fact" : "facts"}.`,
            );
          const subject = section.roleScoped
            ? get(w.roles, data.roleId!)
            : get(w.organisations, orgId);
          subject.sectionStatus ||= {};
          subject.sectionStatus[section.section] = {
            stage: data.stage,
            by: member.userId,
            at: now(),
          };
          subject.version++;
          subject.updatedAt = now();
          audit(w, member.userId, "section.status", subject.id);
          return sectionsView(w, orgId, data.roleId).sections.find(
            (item) => item.section === section.section,
          );
        }),
      );
    }),
  );
  app.put(
    "/api/orgs/:orgId/sections/:section/note",
    handler(async (req, res) => {
      const section = sections.find(
        (item) => item.section === String(req.params.section),
      );
      if (!section) throw new HttpError(404, "Section not found.");
      const data = z
        .object({
          text: z
            .string()
            .transform((value) => value.trim())
            .refine((value) => value.length <= sectionNoteMaxLength, {
              message: `A designer's note cannot be longer than ${sectionNoteMaxLength.toLocaleString("en-GB")} characters.`,
            }),
          roleId: z.string().uuid().optional(),
        })
        .parse(req.body);
      if (section.roleScoped && !data.roleId)
        throw new HttpError(422, "A role is required for this section.");
      if (!section.roleScoped && data.roleId)
        throw new HttpError(
          422,
          "A role is not allowed for an organisation-wide section.",
        );
      res.json(
        await mutate(req, res, (w, member) => {
          requireRole(member, ["researcher", "reviewer", "admin"]);
          const orgId = String(req.params.orgId);
          roleInOrg(w, orgId, data.roleId);
          const subject = section.roleScoped
            ? get(w.roles, data.roleId!)
            : get(w.organisations, orgId);
          if (data.text) {
            subject.sectionNotes ||= {};
            subject.sectionNotes[section.section] = {
              text: data.text,
              by: member.name,
              at: now(),
            };
          } else if (subject.sectionNotes) {
            delete subject.sectionNotes[section.section];
          }
          subject.version++;
          subject.updatedAt = now();
          audit(w, member.userId, "section.note", subject.id);
          return {
            note: subject.sectionNotes?.[section.section] || null,
          };
        }),
      );
    }),
  );
  app.patch(
    "/api/sources/:id",
    handler(async (req, res) => {
      const data = z
        .object({
          permission: z.enum([
            "research-only",
            "awaiting-confirmation",
            "learner-approved",
          ]),
          caption: optionalText,
          roleIds: z.array(z.string().uuid()).default([]),
          ...sourceKnowledgeShape,
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const s = get(w.sources, String(req.params.id));
          data.roleIds.forEach((id) => roleInOrg(w, s.orgId, id));
          touch(s, req.body.version);
          requireTierReason(data);
          if (data.transcriptSourceId) {
            const transcript = get(w.sources, data.transcriptSourceId);
            if (transcript.orgId !== s.orgId)
              throw new HttpError(422, "The transcript source must belong to this organisation.");
          }
          const effective = sourceView({
            ...s,
            tier: data.tier === null ? undefined : (data.tier ?? s.tier),
            providedBy:
              data.providedBy === null
                ? undefined
                : (data.providedBy ?? s.providedBy),
          });
          if (effective.tier !== 1) {
            const organisation = get(w.organisations, s.orgId);
            const lists = [
              organisation.mayUse?.some((item) => item.sourceId === s.id)
                ? "Names we may use"
                : "",
              organisation.mustNotSay?.some((item) => item.sourceId === s.id)
                ? "Things we must not say"
                : "",
            ].filter(Boolean);
            if (lists.length)
              throw new HttpError(
                422,
                `${lists.join(" and ")} must cite tier-1 sources, so this source cannot be demoted.`,
              );
          }
          const {
            tier,
            folder,
            rights,
            transcriptSourceId,
            timecode,
            providedBy,
            ...changes
          } = data;
          Object.assign(s, changes);
          if (tier === null) {
            delete s.tier;
            delete s.tierReason;
          } else if (tier !== undefined) s.tier = tier;
          if (folder === null) delete s.folder;
          else if (folder !== undefined) s.folder = folder;
          if (rights === null) delete s.rights;
          else if (rights !== undefined) s.rights = rights;
          if (transcriptSourceId === null) delete s.transcriptSourceId;
          else if (transcriptSourceId !== undefined)
            s.transcriptSourceId = transcriptSourceId;
          if (timecode === null) delete s.timecode;
          else if (timecode !== undefined) s.timecode = timecode;
          if (providedBy === null) delete s.providedBy;
          else if (providedBy !== undefined) s.providedBy = providedBy;
          audit(w, m.userId, "Source details or scope updated", s.id);
          const { blob, ...clean } = s;
          return sourceView(clean);
        }),
      );
    }),
  );
  app.post(
    "/api/organisations/:id/findings",
    handler(async (req, res) => {
      const data = findingInput.parse(req.body);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const orgId = String(req.params.id);
          roleInOrg(w, orgId, data.roleId);
          const structured = structuredFinding(
            w.sources,
            orgId,
            data.slot as Finding["slot"],
            data.fields,
            data.citations,
            w,
          );
          const claim = structured.claim || data.claim;
          if (!claim)
            throw new HttpError(
              422,
              "A fact is required when structured fields are not supplied.",
            );
          const inventedMeasurement =
            data.slot === "case.measurement" &&
            data.fields?.origin === "invented and declared";
          if (!inventedMeasurement)
            validateCitations(w.sources, orgId, data.kind, data.citations);
          const finding: Finding = {
            ...base(),
            ...data,
            claim,
            slot: data.slot as Finding["slot"],
            orgId,
            review: "unreviewed" as const,
            runIds: [],
            history: [],
          };
          w.findings.push(finding);
          audit(w, m.userId, "Fact created", finding.id);
          return findingView(w, finding);
        }),
      );
    }),
  );
  app.patch(
    "/api/findings/:id",
    handler(async (req, res) => {
      const data = z
        .object({
          claim: z.string().min(1).max(8000).optional(),
          kind: z.enum(["company", "occupation", "proposal"]),
          citations: z.array(citation).max(12).optional(),
          review,
          rationale: optionalText,
          slot: z.enum(["none", ...slots.map((slot) => slot.slot)] as [string, ...string[]]).optional(),
          parts: z
            .array(z.enum(["day", "workflow", "matters", "call"]))
            .max(4)
            .refine((parts) => new Set(parts).size === parts.length, {
              message: "Each chapter part may only be included once.",
            })
            .optional(),
          fields: z.record(z.string(), z.unknown()).optional(),
          verified: z.object({ note: z.string().trim().max(2000).optional() }).nullable().optional(),
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const f = get(w.findings, String(req.params.id));
          if (
            Object.prototype.hasOwnProperty.call(req.body, "verified") &&
            !["reviewer", "admin"].includes(m.role)
          )
            throw new HttpError(403, "Only reviewers and administrators can verify a fact.");
          const { verified, ...changes } = data;
          const effectiveSlot = (changes.slot ?? f.slot) as Finding["slot"];
          const effectiveFields = changes.fields ?? f.fields;
          const effectiveCitations = changes.citations ?? f.citations;
          const structured = structuredFinding(
            w.sources,
            f.orgId,
            effectiveSlot,
            effectiveFields,
            effectiveCitations,
            w,
          );
          if (structured.claim) changes.claim = structured.claim;
          const substantiveChange =
            changes.claim !== f.claim ||
            changes.kind !== f.kind ||
            (changes.citations !== undefined &&
              JSON.stringify(changes.citations) !==
                JSON.stringify(f.citations)) ||
            (changes.fields !== undefined &&
              JSON.stringify(changes.fields) !== JSON.stringify(f.fields)) ||
            (changes.slot !== undefined &&
              changes.slot !== (f.slot || "none"));
          reviewFinding(
            w,
            m,
            f,
            changes as Partial<
              Pick<
                Finding,
                | "claim"
                | "kind"
                | "citations"
                | "review"
                | "rationale"
                | "slot"
                | "parts"
                | "fields"
              >
            >,
            req.body.version,
          );
          if (verified === null) delete f.verified;
          else if (verified !== undefined)
            f.verified = { ...verified, by: m.name, at: now() };
          else if (substantiveChange) delete f.verified;
          return findingView(w, f);
        }),
      );
    }),
  );
  app.post(
    "/api/findings/bulk-review",
    handler(async (req, res) => {
      const data = z
        .object({
          ids: z
            .array(z.string().uuid())
            .min(1)
            .max(100)
            .refine((ids) => new Set(ids).size === ids.length, {
              message: "Each fact may only be included once.",
            }),
          review,
          rationale: z.string().trim().max(20000).optional(),
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          // Resolve every id before changing anything. The transaction also
          // guarantees that a failure leaves every fact untouched.
          const findings = data.ids.map((id) => get(w.findings, id));
          for (const finding of findings)
            reviewFinding(
              w,
              m,
              finding,
              {
                review: data.review,
                ...(data.rationale === undefined
                  ? {}
                  : { rationale: data.rationale }),
              },
              undefined,
              true,
            );
          return {
            findings: findings.map((finding) => findingView(w, finding)),
          };
        }),
      );
    }),
  );
  app.post(
    "/api/organisations/:id/questions",
    handler(async (req, res) => {
      const data = questionInput.parse(req.body);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const orgId = String(req.params.id);
          roleInOrg(w, orgId, data.roleId);
          const q = {
            ...base(),
            ...data,
            orgId,
            status: "open" as const,
            answer: "",
            provenance: "",
            runIds: [],
          };
          w.questions.push(q);
          audit(w, m.userId, "Question created", q.id);
          return q;
        }),
      );
    }),
  );
  app.patch(
    "/api/questions/:id",
    handler(async (req, res) => {
      const data = z
        .object({
          status: z.enum(["open", "client", "deferred", "answered"]),
          answer: optionalText,
          provenance: optionalText,
          assignee: optionalText,
        })
        .parse(req.body);
      if (data.status === "answered" && (!data.answer || !data.provenance))
        throw new HttpError(
          422,
          "Record the answer and who or what supplied it.",
        );
      res.json(
        await mutate(req, res, (w, m) => {
          const q = get(w.questions, String(req.params.id));
          touch(q, req.body.version);
          Object.assign(q, data, {
            answeredBy: data.status === "answered" ? m.userId : undefined,
          });
          audit(w, m.userId, "Question updated", q.id);
          return q;
        }),
      );
    }),
  );
  app.post(
    "/api/questions/:id/fact",
    handler(async (req, res) => {
      const data = z.object({
        slot: z.enum(["none", ...slots.map((slot) => slot.slot)] as [string, ...string[]]),
        parts: z.array(z.enum(["day", "workflow", "matters", "call"])).max(4).default([]),
        claim: z.string().trim().min(1).max(8000).optional(),
      }).parse(req.body);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const question = get(w.questions, String(req.params.id));
          if (question.status !== "answered" || !question.answer.trim())
            throw new HttpError(422, "Only an answered question with a recorded answer can become a fact.");
          const source: Source = {
            ...base(),
            orgId: question.orgId,
            roleIds: question.roleId ? [question.roleId] : [],
            title: `Answer to question: ${question.text}`.slice(0, 200),
            kind: "statement",
            folder: "06-organisation-supplied",
            url: "",
            text: question.answer,
            locator: `Answer to question ${question.id}`,
            permission: "research-only",
            verification: "client-confirmed",
            suppliedBy: m.name,
            providedBy: question.answeredBy
              ? { name: question.answeredBy, jobTitle: "" }
              : undefined,
            publishedAt: "",
            retrievedAt: now(),
            runIds: [],
          };
          const finding = {
            ...base(),
            orgId: question.orgId,
            roleId: question.roleId,
            kind: "company" as const,
            claim: data.claim || question.answer,
            citations: [{ sourceId: source.id, quote: question.answer, locator: source.locator }],
            rationale: `Recorded from the organisation's answer to question ${question.id}.`,
            review: "unreviewed" as const,
            slot: data.slot as Finding["slot"],
            parts: data.parts,
            runIds: [],
            history: [],
          };
          w.sources.push(source);
          w.findings.push(finding);
          audit(w, m.userId, "Question answer converted to fact", finding.id);
          return { source: sourceView(source), finding: findingView(w, finding) };
        }),
      );
    }),
  );
  app.get(
    "/api/orgs/:orgId/sections",
    handler(async (req, res) => {
      const query = z.object({ roleId: z.string().uuid().optional() }).parse(req.query);
      const response: SectionsResponse = sectionsView(
        await store.read(),
        String(req.params.orgId),
        query.roleId,
      );
      res.json(response);
    }),
  );
  app.post(
    "/api/organisations/:id/activities",
    handler(async (req, res) => {
      const data = activityInput.parse(req.body);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const orgId = String(req.params.id);
          roleInOrg(w, orgId, data.roleId);
          for (const id of data.findingIds) {
            const f = get(w.findings, id);
            if (f.orgId !== orgId || (f.roleId && f.roleId !== data.roleId))
              throw new HttpError(422, "Fact is outside this role.");
          }
          const a = {
            ...base(),
            ...data,
            orgId,
            review: "unreviewed" as const,
            runIds: [],
          };
          w.activities.push(a);
          audit(w, m.userId, "Activity proposed", a.id);
          return a;
        }),
      );
    }),
  );
  app.patch(
    "/api/activities/:id",
    handler(async (req, res) => {
      const data = z
        .object({ review, confirmation: optionalText })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const a = get(w.activities, String(req.params.id));
          touch(a, req.body.version);
          Object.assign(a, data);
          audit(w, m.userId, "Activity reviewed", a.id);
          return a;
        }),
      );
    }),
  );
  app.get(
    "/api/roles/:id/readiness",
    handler(async (req, res) => {
      const w = await store.read();
      const role = get(w.roles, String(req.params.id));
      res.json({ issues: readiness(w, role.orgId, role.id) });
    }),
  );
  app.post(
    "/api/roles/:id/packs",
    handler(async (req, res) => {
      const status = z.enum(["draft", "ready"]).parse(req.body.status);
      res.status(201).json(
        await mutate(req, res, async (w, m, db) => {
          if (status === "ready" && !["reviewer", "admin"].includes(m.role))
            throw new HttpError(
              403,
              "A reviewer or administrator must mark a pack ready.",
            );
          const role = get(w.roles, String(req.params.id));
          const previous = await db.query(
            "SELECT COALESCE(MAX(revision),0) AS revision FROM research_packs WHERE role_id=$1",
            [role.id],
          );
          const pack = makePack(
            w,
            role.orgId,
            role.id,
            m.userId,
            status,
            Number(previous.rows[0].revision) + 1,
            m.name,
          );
          await db.query(
            "INSERT INTO research_packs(id,org_id,role_id,revision,snapshot) VALUES($1,$2,$3,$4,$5)",
            [pack.id, role.orgId, role.id, pack.revision, JSON.stringify(pack)],
          );
          audit(w, m.userId, `Immutable ${status} pack created`, pack.id);
          return pack;
        }),
      );
    }),
  );
  app.get(
    "/api/packs/:id/docx",
    handler(async (req, res) => {
      const pack = get(await store.packs(), String(req.params.id));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${packZipName(pack).replace(/\.zip$/, ".docx")}"`,
      );
      res
        .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        .send(await packDocx(pack));
    }),
  );
  app.get(
    "/api/packs/:id/zip",
    handler(async (req, res) => {
      const pack = get(await store.packs(), String(req.params.id));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${packZipName(pack)}"`,
      );
      res.type("application/zip");
      const stream = await packFolderZipStream(pack, store);
      stream.on("error", () => {
        if (!res.headersSent) res.status(500);
        res.end();
      });
      stream.pipe(res);
    }),
  );
  app.get(
    "/api/packs/:id/confirm.md",
    handler(async (req, res) => {
      const pack = get(await store.packs(), String(req.params.id));
      if (pack.schemaVersion !== "2.0.0")
        throw new HttpError(
          404,
          "The confirmation page is not available for schema 1.0.0 packs.",
        );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="for-organisation-to-confirm-r${pack.revision}.md"`,
      );
      res.type("text/markdown").send(confirmationMarkdown(pack));
    }),
  );
  app.get(
    "/api/packs/:id/:format",
    handler(async (req, res) => {
      const p = get(await store.packs(), String(req.params.id));
      const format = z.enum(["json", "md"]).parse(req.params.format);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="research-pack-r${p.revision}-${p.id}.${format}"`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res
        .type(format === "json" ? "application/json" : "text/markdown")
        .send(format === "json" ? JSON.stringify(p, null, 2) : packMarkdown(p));
    }),
  );
  app.post(
    "/api/organisations/:id/research",
    handler(async (req, res) => {
      const data = z
        .object({
          roleId: z.string().uuid().optional(),
          tier: z.enum(["economy", "power", "max"]),
          sections: z.array(z.enum(sections.map((section) => section.section) as [string, ...string[]])).max(6).optional(),
          sourceIds: z.array(z.string().uuid()).max(16).optional(),
          crawl: z.boolean().optional(),
        })
        .parse(req.body);
      res.status(202).json(
        await mutate(req, res, (w, m) => {
          const orgId = String(req.params.id);
          roleInOrg(w, orgId, data.roleId);
          if (data.sections?.length) {
            const summaries = sectionsView(w, orgId, data.roleId).sections;
            for (const sectionId of data.sections) {
              const section = sections.find(
                (item) => item.section === sectionId,
              )!;
              if (section.roleScoped && !data.roleId)
                throw new HttpError(
                  422,
                  `${section.title} requires a role from this organisation.`,
                );
              const summary = summaries.find(
                (item) => item.section === sectionId,
              )!;
              if (summary.status.stage === "gathering")
                throw new HttpError(
                  422,
                  `${section.title}: Mark the folder complete first.`,
                );
            }
          }
          if (data.sourceIds)
            for (const id of data.sourceIds) {
              const source = w.sources.find((item) => item.id === id);
              if (
                !source ||
                source.orgId !== orgId ||
                (data.roleId && source.roleIds.length && !source.roleIds.includes(data.roleId)) ||
                !source.text.trim() ||
                !!source.error
              )
                throw new HttpError(422, "Every selected source must be readable and belong to this organisation and role.");
            }
          if (!providers(w)[data.tier])
            throw new HttpError(
              503,
              "The selected research tier is not configured. Check the provider keys and models under Research connections.",
            );
          const active = w.jobs.find(
            (j) =>
              j.orgId === orgId &&
              j.roleId === data.roleId &&
              ["queued", "researching"].includes(j.status),
          );
          if (active) return active;
          const job: ResearchJob = {
            ...base(),
            ...data,
            sections: data.sections as ResearchJob["sections"],
            orgId,
            status: "queued" as const,
            stage: "Waiting to research",
            errors: [],
            requestedBy: m.userId,
            attempts: 0,
            runs: [],
          };
          w.jobs.push(job);
          audit(w, m.userId, "Research queued", job.id);
          return job;
        }),
      );
    }),
  );
  app.post(
    "/api/jobs/:id/cancel",
    handler(async (req, res) =>
      res.json(
        await mutate(req, res, (w, m) => {
          const j = get(w.jobs, String(req.params.id));
          if (["queued", "researching"].includes(j.status)) {
            j.status = "cancelled";
            j.stage = "Cancelled; completed evidence retained";
            j.updatedAt = now();
            audit(w, m.userId, "Research cancelled", j.id);
          }
          return j;
        }),
      ),
    ),
  );
  app.post(
    "/api/members",
    handler(async (req, res) => {
      const data = z
        .object({
          userId: z
            .string()
            .regex(/^user_/)
            .max(150),
          name: z.string().min(1).max(150),
          role: z.enum(["researcher", "reviewer", "admin"]),
          active: z.boolean(),
        })
        .parse(req.body);
      res.json(
        await mutate(
          req,
          res,
          (w, m) => {
            if (
              data.userId === m.userId &&
              (!data.active || data.role !== "admin") &&
              w.members.filter((x) => x.active && x.role === "admin").length <=
                1
            )
              throw new HttpError(
                422,
                "Keep at least one active administrator.",
              );
            const existing = w.members.find((x) => x.userId === data.userId);
            if (existing) Object.assign(existing, data);
            else w.members.push(data);
            audit(w, m.userId, "Workspace membership updated", data.userId);
            return data;
          },
          true,
        ),
      );
    }),
  );
  // Research settings: which model each connection uses and the editable
  // research instructions. Everyone can read them; administrators change them.
  const settingsView = (w: Workspace) => ({
    slots: SLOTS.map((info) => {
      const resolved = resolveModel(w, info.slot);
      return {
        ...info,
        providerLabel: PROVIDER_LABEL[info.provider],
        model: resolved.model ?? null,
        source: resolved.source,
        problem: resolved.problem ?? null,
        environmentModel: process.env[info.envVar]?.trim() || null,
        access: !!providerAccess(info.provider),
        options: CATALOGUE[info.provider],
      };
    }),
    tiers: providers(w),
    prompt: promptSettings(w),
    defaultInstructions: DEFAULT_INSTRUCTIONS,
    contract: OUTPUT_CONTRACT,
    contextNote: CONTEXT_NOTE,
  });
  app.get(
    "/api/research-settings",
    handler(async (_req, res) => res.json(settingsView(await store.read()))),
  );
  app.put(
    "/api/research-settings/models/:slot",
    handler(async (req, res) => {
      const info = SLOTS.find((s) => s.slot === req.params.slot);
      if (!info) throw new HttpError(404, "Unknown research connection.");
      const { model } = z
        .object({ model: z.string().trim().max(100) })
        .parse(req.body);
      if ((res.locals.member as Member).role !== "admin")
        throw new HttpError(403, "Administrator access required.");
      if (model) {
        if (!MODEL_ID.test(model))
          throw new HttpError(422, "Enter a model ID such as claude-sonnet-5.");
        if (providerOf(model) !== info.provider)
          throw new HttpError(
            422,
            `${info.label} runs on ${PROVIDER_LABEL[info.provider]}; "${model}" would be sent to ${PROVIDER_LABEL[providerOf(model)]}.`,
          );
        if (!providerAccess(info.provider))
          throw new HttpError(
            422,
            `No ${PROVIDER_LABEL[info.provider]} connection is configured on the server, so the model cannot be verified.`,
          );
        // Verified live before anything is stored: a saved model must answer.
        try {
          await probeModel(model);
        } catch (e) {
          throw new HttpError(
            422,
            `"${model}" did not answer through the ${PROVIDER_LABEL[info.provider]} connection: ${(e as Error).message}`,
          );
        }
      } else {
        const env = process.env[info.envVar]?.trim();
        if (!env)
          throw new HttpError(
            422,
            `There is no environment default for ${info.label}; choose a model instead.`,
          );
        const problem = slotProblem(info, env);
        if (problem) throw new HttpError(422, problem);
      }
      res.json(
        await mutate(
          req,
          res,
          (w, m) => {
            const settings = settingsOf(w);
            const before = resolveModel(w, info.slot).model ?? "none";
            if (model) settings.models[info.slot] = model;
            else delete settings.models[info.slot];
            const after = resolveModel(w, info.slot).model ?? "none";
            audit(
              w,
              m.userId,
              `Research model changed for ${info.label}: ${before} → ${after}${model ? " (verified with a live request)" : " (environment default)"}`,
              info.slot,
            );
            return settingsView(w);
          },
          true,
        ),
      );
    }),
  );
  app.put(
    "/api/research-settings/prompt",
    handler(async (req, res) => {
      const data = z
        .object({
          instructions: z.string().max(20000).optional(),
          reset: z.boolean().optional(),
          version: z.number().int().nonnegative(),
        })
        .parse(req.body);
      const instructions = data.reset
        ? DEFAULT_INSTRUCTIONS
        : (data.instructions ?? "").replace(/\r\n/g, "\n").trim();
      if (!instructions)
        throw new HttpError(422, "The research instructions cannot be empty.");
      res.json(
        await mutate(
          req,
          res,
          (w, m) => {
            const current = promptSettings(w);
            if (current.version !== data.version)
              throw new HttpError(
                409,
                "The research prompt changed since you opened it. Reload and review the current version before saving.",
              );
            if (instructions === current.instructions)
              throw new HttpError(422, "Nothing changed in the instructions.");
            settingsOf(w).prompt = {
              instructions,
              version: current.version + 1,
              updatedAt: now(),
              updatedBy: m.userId,
            };
            audit(
              w,
              m.userId,
              data.reset
                ? `Research prompt reset to the built-in default (version ${current.version + 1})`
                : `Research prompt updated (version ${current.version + 1})`,
              "research-prompt",
            );
            return settingsView(w);
          },
          true,
        ),
      );
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  app.use((e: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof z.ZodError
          ? 422
          : e instanceof multer.MulterError
            ? 413
            : 500;
    res.status(status).json({
      error:
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : status === 500
            ? "The operation failed. Check server logs or retry."
            : e.message,
    });
    if (status === 500) console.error("Request failed:", e.message);
  });
  if (options.serveFrontend) {
    app.use(express.static(path.resolve("dist")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.resolve("dist/index.html")),
    );
  }
  return app;
}
