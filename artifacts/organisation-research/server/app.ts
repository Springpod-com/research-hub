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
  occupationInput,
  optionalText,
  review,
  roleInOrg,
  validateCitations,
  readiness,
  makePack,
  packMarkdown,
  suggestOrganisations,
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
  inviteByEmail,
  lookUpClerkUserByEmail,
  normaliseEmail,
  redeemInvitation,
  verifiedPrimaryEmail,
  withdrawInvitation,
} from "./members.js";
import {
  datasetSummaries,
  automaticOccupations,
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
import { researchReady } from "./research.js";
import { researchModel } from "./models.js";
import { fetchPublic, extractPage } from "./retrieval.js";
import { allowedOrigins } from "./origins.js";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./clerk-proxy.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
  /** Finds the Clerk user ID for a work email; defaults to the Clerk API. */
  lookUpUserByEmail?: (email: string) => Promise<string | undefined>;
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

const imageSignature = (data: Buffer) => {
  const png = data
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  return png ? "image/png" : jpeg ? "image/jpeg" : undefined;
};

async function scanUpload(data: Buffer, name?: string): Promise<boolean> {
  if (process.env.UPLOAD_SCAN_COMMAND) {
    return await new Promise<boolean>((resolve, reject) => {
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
        if (code === 0) resolve(true);
        else if (code === 1)
          reject(
            new HttpError(
              422,
              name
                ? `${name} did not pass the upload scan.`
                : "File did not pass the upload scan.",
            ),
          );
        else reject(new HttpError(503, "File scanner unavailable."));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(data);
    });
  } else if (process.env.NODE_ENV === "production")
    throw new HttpError(
      503,
      "An upload scanner must be configured before production file uploads.",
    );
  return false;
}

const safeArchiveFilename = (value: string) =>
  value
    .normalize("NFC")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
      "",
    )
    .trim()
    .slice(0, 255) || "image";
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
function isBootstrapAdmin(userId: string, email: string | undefined) {
  if (csv(process.env.BOOTSTRAP_ADMIN_IDS).includes(userId)) return true;
  const emails = csv(process.env.BOOTSTRAP_ADMIN_EMAILS).map((e) =>
    e.toLowerCase(),
  );
  return !!email && emails.includes(email);
}
/**
 * The verified primary email of a signed-in account, looked up once per
 * request from someone who is not (yet) a member. A Clerk outage must not
 * turn "no access" into a server error, so failures count as "no email".
 */
async function signedInEmail(userId: string): Promise<string | undefined> {
  try {
    return verifiedPrimaryEmail(await clerkClient.users.getUser(userId));
  } catch (error) {
    console.warn(
      `[auth] could not read the Clerk account for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
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
      const userId = auth.userId;
      const current = await store.read();
      let member = current.members.find((m) => m.userId === userId);
      if (!member) {
        // Not a member yet: an invitation for this person's email, or the
        // initial administrator, is the only way in. The Clerk account is
        // read only when one of those could apply, and the document is only
        // written when it does.
        const byId = isBootstrapAdmin(userId, undefined);
        const needsEmail =
          !byId &&
          (current.invitations?.length ||
            csv(process.env.BOOTSTRAP_ADMIN_EMAILS).length);
        const email = needsEmail ? await signedInEmail(userId) : undefined;
        // The configured administrator always outranks an invitation, so a
        // fresh instance can never end up without an administrator.
        const bootstrap = byId || isBootstrapAdmin(userId, email);
        const invited =
          !!email && !!current.invitations?.some((i) => i.email === email);
        if (bootstrap || invited)
          member = await store.transact((w) => {
            const existing = w.members.find((m) => m.userId === userId);
            if (existing) return existing;
            if (!bootstrap) return redeemInvitation(w, userId, email);
            const item: Member = {
              userId,
              name: "Workspace administrator",
              role: "admin",
              active: true,
              ...(email ? { email } : {}),
            };
            w.members.push(item);
            if (email) {
              const pending = w.invitations?.find((i) => i.email === email);
              if (pending) withdrawInvitation(w, item, pending.id);
            }
            audit(w, userId, "Initial administrator provisioned", userId);
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
    expectedVersion: unknown,
    withoutVersion = false,
  ) => {
    const kind = changes.kind ?? finding.kind;
    const citations = changes.citations ?? finding.citations;
    const slot = changes.slot ?? finding.slot;
    const fields = changes.fields ?? finding.fields;
    structuredFinding(w.sources, finding.orgId, slot, fields, citations, w);
    const inventedMeasurement =
      slot === "case.measurement" && fields?.origin === "invented and declared";
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
        research: { ready: researchReady(), model: researchModel().model ?? null },
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
        roles: w.roles,
        sources: w.sources.map(({ blob, ...s }) => sourceView(s)),
        findings: w.findings.map((f) => findingView(w, f)),
        members:
          res.locals.member.role === "admin"
            ? w.members
            : w.members.map(({ name, userId }) => ({ name, userId })),
        invitations:
          res.locals.member.role === "admin" ? (w.invitations ?? []) : [],
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
          for (const [key, value] of Object.entries({
            factChecker,
            brand,
            mayUse,
            mustNotSay,
          }))
            if (value === null)
              delete (item as unknown as Record<string, unknown>)[key];
            else if (value !== undefined)
              (item as unknown as Record<string, unknown>)[key] = value;
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
          const { standard, ncsUrl, professionalBody, interview, ...changes } =
            data;
          Object.assign(role, changes);
          for (const [key, value] of Object.entries({
            standard,
            ncsUrl,
            professionalBody,
            interview,
          }))
            if (value === null)
              delete (role as unknown as Record<string, unknown>)[key];
            else if (value !== undefined)
              (role as unknown as Record<string, unknown>)[key] = value;
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
        data.tierReason ||= `Team note; extracted from ${data.extractedFrom}`;
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
  const boundedMemoryStorage: multer.StorageEngine = {
    _handleFile(_req, file, done) {
      const cap = file.originalname.toLowerCase().endsWith(".zip")
        ? 100 * 1024 * 1024
        : 10 * 1024 * 1024;
      let chunks: Buffer[] = [];
      let size = 0;
      let complete = false;
      const detach = () => {
        file.stream.off("data", onData);
        file.stream.off("end", onEnd);
        file.stream.off("error", onError);
      };
      const fail = (error: Error) => {
        if (complete) return;
        complete = true;
        detach();
        // Release what was buffered before the request is drained, so a slow
        // oversized upload cannot keep its bytes resident until it ends.
        chunks = [];
        file.stream.resume();
        done(error);
      };
      const onData = (chunk: Buffer) => {
        size += chunk.length;
        if (size > cap) {
          fail(new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname));
          return;
        }
        chunks.push(chunk);
      };
      const onError = (error: Error) => fail(error);
      const onEnd = () => {
        if (complete) return;
        complete = true;
        detach();
        const buffer = Buffer.concat(chunks);
        chunks = [];
        done(null, { buffer, size });
      };
      file.stream.on("data", onData);
      file.stream.on("error", onError);
      file.stream.on("end", onEnd);
    },
    _removeFile(_req, file, done) {
      delete (file as { buffer?: Buffer }).buffer;
      done(null);
    },
  };
  const upload = multer({
    storage: boundedMemoryStorage,
    limits: { files: 1, fields: 10 },
    fileFilter: (req, file, done) => {
      (req as Request & { uploadName?: string }).uploadName = file.originalname;
      done(null, true);
    },
  });
  const receiveUpload: RequestHandler = (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (
        error instanceof multer.MulterError &&
        error.code === "LIMIT_FILE_SIZE" &&
        path
          .extname((req as Request & { uploadName?: string }).uploadName || "")
          .toLowerCase() === ".zip"
      )
        return next(new HttpError(413, "ZIP files can be up to 100 MB."));
      next(error);
    });
  };
  app.post(
    "/api/organisations/:id/upload",
    receiveUpload,
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
        ".zip",
      ];
      if (!allowed.includes(ext))
        throw new HttpError(
          422,
          "Use PDF, DOCX, TXT, Markdown, PNG or JPEG up to 10 MB, or a ZIP up to 100 MB.",
        );
      if (ext === ".zip") {
        if (f.buffer.subarray(0, 2).toString() !== "PK")
          throw new HttpError(422, "This file is not a valid ZIP.");
        const { default: JSZip } = await import("jszip");
        let zip;
        try {
          zip = await JSZip.loadAsync(f.buffer);
        } catch {
          throw new HttpError(422, "This file is not a valid ZIP.");
        }
        const entries = Object.values(zip.files);
        if (entries.length > 500)
          throw new HttpError(
            422,
            "ZIP files can contain at most 500 entries.",
          );
        const kept: Array<{
          data: Buffer;
          name: string;
          filename: string;
          mime: "image/png" | "image/jpeg";
        }> = [];
        const eligible: Array<{
          entry: (typeof entries)[number];
          filename: string;
        }> = [];
        const skipped: Array<{
          name: string;
          reason: "not-image" | "duplicate";
        }> = [];
        let expandedTotal = 0;
        for (const entry of entries) {
          const normalised = entry.name.replaceAll("\\", "/");
          const parts = normalised.split("/").filter(Boolean);
          const rawFilename = parts.at(-1) || "";
          if (
            entry.dir ||
            parts.includes("__MACOSX") ||
            parts.some((part) => part.startsWith(".")) ||
            rawFilename.toLowerCase() === "thumbs.db"
          )
            continue;
          if (
            ![".png", ".jpg", ".jpeg"].includes(
              path.extname(rawFilename).toLowerCase(),
            )
          ) {
            skipped.push({ name: entry.name, reason: "not-image" });
            continue;
          }
          const size = Number((entry as any)._data?.uncompressedSize || 0);
          if (size > 10 * 1024 * 1024)
            throw new HttpError(
              422,
              `${entry.name} exceeds the 10 MB uncompressed image limit.`,
            );
          expandedTotal += size;
          if (expandedTotal > 200 * 1024 * 1024)
            throw new HttpError(
              422,
              "The ZIP's eligible images can be at most 200 MB uncompressed.",
            );
          eligible.push({
            entry,
            filename: safeArchiveFilename(rawFilename),
          });
          if (eligible.length > 200)
            throw new HttpError(422, "A ZIP can import at most 200 images.");
        }
        const hashes = new Set<string>();
        for (const { entry, filename } of eligible) {
          const data = await entry.async("nodebuffer");
          const mime = imageSignature(data);
          if (!mime) {
            skipped.push({ name: entry.name, reason: "not-image" });
            continue;
          }
          const hash = createHash("sha256").update(data).digest("hex");
          if (hashes.has(hash)) {
            skipped.push({ name: entry.name, reason: "duplicate" });
            continue;
          }
          hashes.add(hash);
          kept.push({ data, name: entry.name, filename, mime });
        }
        if (!kept.length)
          throw new HttpError(422, "The ZIP contains no PNG or JPEG images.");
        const scanVerdicts: boolean[] = [];
        for (const image of kept)
          scanVerdicts.push(await scanUpload(image.data, image.name));
        const sources: Source[] = kept.map((image) => ({
          ...base(),
          orgId,
          roleIds: roleId ? [roleId] : [],
          title:
            path
              .basename(image.filename, path.extname(image.filename))
              .slice(0, 200) || "image",
          kind: "image",
          url: "",
          text: "",
          locator: "Workplace reference image",
          permission: "awaiting-confirmation",
          verification: "user-supplied",
          suppliedBy: res.locals.member.name,
          publishedAt: "",
          retrievedAt: now(),
          filename: image.filename,
          mime: image.mime,
          caption: String(req.body.caption || "").slice(0, 4000),
          runIds: [],
          ...uploadKnowledge,
        }));
        await mutate(req, res, async (w, m, db) => {
          for (const [index, source] of sources.entries()) {
            await Store.putFile(
              db,
              source.id,
              kept[index].data,
              scanVerdicts[index],
            );
            w.sources.push(source);
            audit(w, m.userId, "Source uploaded", source.id);
          }
          audit(
            w,
            m.userId,
            `Imported ${sources.length} images from ${f.originalname}`,
            orgId,
          );
        });
        res.status(201).json({
          imported: sources.length,
          sources: sources.map(sourceView),
          skipped,
        });
        return;
      }
      const scanClean = await scanUpload(f.buffer);
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
        const imageMime = imageSignature(f.buffer);
        if (!imageMime)
          throw new HttpError(
            422,
            "Image signature does not match PNG or JPEG.",
          );
        mime = imageMime;
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
        await Store.putFile(db, source.id, f.buffer, scanClean);
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
          stage: z.enum(["gathering", "reviewed"]),
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
          const subject = section.roleScoped
            ? get(w.roles, data.roleId!)
            : get(w.organisations, orgId);
          const previous = subject.sectionStatus?.[section.section];
          if (
            (data.stage === "reviewed" || previous?.stage === "reviewed") &&
            !["reviewer", "admin"].includes(member.role)
          )
            throw new HttpError(
              403,
              "A reviewer or administrator must change the reviewed tick.",
            );
          subject.sectionStatus ||= {};
          const sectionSlots = new Set(
            slots
              .filter((slot) => slot.section === section.section)
              .map((slot) => slot.slot),
          );
          const wasExtracted =
            w.findings.some(
              (finding) =>
                finding.orgId === orgId &&
                finding.review !== "rejected" &&
                (!section.roleScoped ||
                  !finding.roleId ||
                  finding.roleId === data.roleId) &&
                sectionSlots.has(finding.slot as never),
            ) ||
            w.jobs.some(
              (job) =>
                job.orgId === orgId &&
                (!section.roleScoped || job.roleId === data.roleId) &&
                job.sections?.includes(section.section) &&
                ["completed", "gaps"].includes(job.status),
            );
          subject.sectionStatus[section.section] = {
            stage:
              data.stage === "gathering" && previous?.stage === "reviewed"
                ? previous.reviewedFrom ||
                  (wasExtracted ? "extracted" : "gathering")
                : data.stage,
            by: member.userId,
            at: now(),
            ...(data.stage === "reviewed"
              ? {
                  reviewedFrom:
                    previous?.stage === "reviewed"
                      ? previous.reviewedFrom || "gathering"
                      : previous?.stage === "extracted"
                        ? "extracted"
                        : "gathering",
                }
              : {}),
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
              throw new HttpError(
                422,
                "The transcript source must belong to this organisation.",
              );
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
            review: "accepted" as const,
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
          review: z.enum(["accepted", "rejected"]).optional(),
          rationale: optionalText,
          slot: z
            .enum(["none", ...slots.map((slot) => slot.slot)] as [
              string,
              ...string[],
            ])
            .optional(),
          parts: z
            .array(z.enum(["day", "workflow", "matters", "call"]))
            .max(4)
            .refine((parts) => new Set(parts).size === parts.length, {
              message: "Each chapter part may only be included once.",
            })
            .optional(),
          fields: z.record(z.string(), z.unknown()).optional(),
          verified: z
            .object({ note: z.string().trim().max(2000).optional() })
            .nullable()
            .optional(),
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const f = get(w.findings, String(req.params.id));
          if (
            Object.prototype.hasOwnProperty.call(req.body, "verified") &&
            !["reviewer", "admin"].includes(m.role)
          )
            throw new HttpError(
              403,
              "Only reviewers and administrators can verify a fact.",
            );
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
            (changes.slot !== undefined && changes.slot !== (f.slot || "none"));
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
          review: z.enum(["accepted", "rejected"]),
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
      const data = z
        .object({
          slot: z.enum(["none", ...slots.map((slot) => slot.slot)] as [
            string,
            ...string[],
          ]),
          parts: z
            .array(z.enum(["day", "workflow", "matters", "call"]))
            .max(4)
            .default([]),
          claim: z.string().trim().min(1).max(8000).optional(),
        })
        .parse(req.body);
      res.status(201).json(
        await mutate(req, res, (w, m) => {
          const question = get(w.questions, String(req.params.id));
          if (question.status !== "answered" || !question.answer.trim())
            throw new HttpError(
              422,
              "Only an answered question with a recorded answer can become a fact.",
            );
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
            citations: [
              {
                sourceId: source.id,
                quote: question.answer,
                locator: source.locator,
              },
            ],
            rationale: `Recorded from the organisation's answer to question ${question.id}.`,
            review: "accepted" as const,
            slot: data.slot as Finding["slot"],
            parts: data.parts,
            runIds: [],
            history: [],
          };
          w.sources.push(source);
          w.findings.push(finding);
          audit(w, m.userId, "Question answer converted to fact", finding.id);
          return {
            source: sourceView(source),
            finding: findingView(w, finding),
          };
        }),
      );
    }),
  );
  app.get(
    "/api/orgs/:orgId/sections",
    handler(async (req, res) => {
      const query = z
        .object({ roleId: z.string().uuid().optional() })
        .parse(req.query);
      const response: SectionsResponse = sectionsView(
        await store.read(),
        String(req.params.orgId),
        query.roleId,
      );
      res.json(response);
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
      z.object({ status: z.enum(["draft", "ready"]).optional() }).parse(req.body);
      const automatic = await automaticOccupations(
        get((await store.read()).roles, String(req.params.id)),
      );
      res.status(201).json(
        await mutate(req, res, async (w, m, db) => {
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
            "ready",
            Number(previous.rows[0].revision) + 1,
            m.name,
            automatic,
          );
          await db.query(
            "INSERT INTO research_packs(id,org_id,role_id,revision,snapshot) VALUES($1,$2,$3,$4,$5)",
            [pack.id, role.orgId, role.id, pack.revision, JSON.stringify(pack)],
          );
          audit(w, m.userId, "Immutable pack created", pack.id);
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
        .type(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
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
          sections: z
            .array(
              z.enum(
                sections.map((section) => section.section) as [
                  string,
                  ...string[],
                ],
              ),
            )
            .max(6)
            .optional(),
          sourceIds: z.array(z.string().uuid()).max(16).optional(),
          crawl: z.boolean().optional(),
        })
        .parse(req.body);
      res.status(202).json(
        await mutate(req, res, (w, m) => {
          const orgId = String(req.params.id);
          roleInOrg(w, orgId, data.roleId);
          if (data.sections?.some((sectionId) => sections.find((item) => item.section === sectionId)?.roleScoped) && !data.roleId)
            throw new HttpError(422, "A selected folder requires a role from this organisation.");
          for (const sectionId of data.sections || []) {
            const folder = sections.find((item) => item.section === sectionId)!.folder;
            if (
              !w.sources.some(
                (source) =>
                  source.orgId === orgId &&
                  sourceView(source).folder === folder &&
                  (!data.roleId || !source.roleIds.length || source.roleIds.includes(data.roleId)) &&
                  source.text.trim() &&
                  !source.error,
              )
            )
              throw new HttpError(422, "Each selected folder needs at least one readable source.");
          }
          if (data.sourceIds)
            for (const id of data.sourceIds) {
              const source = w.sources.find((item) => item.id === id);
              if (
                !source ||
                source.orgId !== orgId ||
                (data.roleId &&
                  source.roleIds.length &&
                  !source.roleIds.includes(data.roleId)) ||
                !source.text.trim() ||
                !!source.error
              )
                throw new HttpError(
                  422,
                  "Every selected source must be readable and belong to this organisation and role.",
                );
            }
          if (!researchReady())
            throw new HttpError(
              503,
              "Research is not set up on this server. Set RESEARCH_MODEL to an exact model ID and connect its provider.",
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
      // Existing members are edited by Clerk user ID; new people are added
      // by work email, which is resolved to a Clerk user ID when that account
      // has already signed in and otherwise stored as an invitation.
      const body = z
        .object({
          userId: z.string().regex(/^user_/).max(150).optional(),
          email: z
            .string()
            .trim()
            .pipe(z.email().max(254))
            .transform(normaliseEmail)
            .optional(),
          name: z.string().min(1).max(150),
          role: z.enum(["researcher", "reviewer", "admin"]),
          active: z.boolean(),
        })
        .refine((d) => d.userId || d.email, {
          message: "Give a work email address or a Clerk user ID.",
        })
        .parse(req.body);
      if (
        res.locals.member.role !== "admin" ||
        !(res.locals.member as Member).active
      )
        throw new HttpError(403, "Administrator access required.");
      const userId =
        body.userId ??
        (await (options.lookUpUserByEmail ?? lookUpClerkUserByEmail)(
          body.email!,
        ));
      res.json(
        await mutate(
          req,
          res,
          (w, m) => {
            if (!userId) {
              if (!body.active)
                throw new HttpError(
                  422,
                  "Nobody with that email address has signed in yet, so there is no access to revoke.",
                );
              return inviteByEmail(w, m, {
                email: body.email!,
                name: body.name,
                role: body.role,
              });
            }
            const data: Member = { ...body, userId };
            if (!data.email) delete data.email;
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
            if (data.email) {
              const pending = (w.invitations ?? []).find(
                (i) => i.email === data.email,
              );
              if (pending) withdrawInvitation(w, m, pending.id);
            }
            audit(w, m.userId, "Workspace membership updated", data.userId);
            return data;
          },
          true,
        ),
      );
    }),
  );
  app.delete(
    "/api/invitations/:id",
    handler(async (req, res) => {
      res.json(
        await mutate(
          req,
          res,
          (w, m) => {
            if (!withdrawInvitation(w, m, String(req.params.id)))
              throw new HttpError(404, "That invitation no longer exists.");
            return { ok: true };
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
