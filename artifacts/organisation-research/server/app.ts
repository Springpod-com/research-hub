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
  roleInput,
  findingInput,
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
} from "./domain.js";
import {
  datasetSummaries,
  getEntry,
  search as searchOccupations,
  schemes as occupationSchemes,
} from "./occupations.js";
import type { Member, Source, Workspace } from "../shared/types.js";
import { providers } from "./research.js";
import { fetchPublic, extractPage } from "./retrieval.js";
import { allowedOrigins } from "./origins.js";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./clerk-proxy.js";
import { spawn } from "node:child_process";
import path from "node:path";
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
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false,
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
  app.get(
    "/api/session",
    handler(async (_req, res) =>
      res.json({
        ...res.locals.member,
        demo: !!options.preview,
        providers: providers(),
      }),
    ),
  );
  app.get(
    "/api/workspace",
    handler(async (_req, res) => {
      const w = await store.read();
      res.json({
        ...w,
        roles: w.roles.map((r) => roleView(w, r)),
        sources: w.sources.map(({ blob, ...s }) => s),
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
      const data = orgInput.parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const item = get(w.organisations, String(req.params.id));
          touch(item, req.body.version);
          Object.assign(item, data);
          audit(
            w,
            m.userId,
            "Organisation updated; existing snapshots unchanged",
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
      const data = roleInput.parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const role = get(w.roles, String(req.params.id));
          touch(role, req.body.version);
          Object.assign(role, data);
          audit(w, m.userId, "Role updated", role.id);
          return role;
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
          text: z.string().min(1).max(100000),
          kind: z.enum(["statement", "occupation", "document"]),
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
        })
        .parse(req.body);
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
          return source;
        }),
      );
    }),
  );
  app.post(
    "/api/organisations/:id/web-source",
    handler(async (req, res) => {
      const data = z
        .object({ url: z.string().url(), roleId: z.string().uuid().optional() })
        .parse(req.body);
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
          };
          w.sources.push(source);
          audit(w, m.userId, "Public page captured", source.id);
          return source;
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
          for (const f of w.findings) {
            const cited = f.citations.filter((c) => lineage.has(c.sourceId));
            if (!cited.length) continue;
            const quoteFound = cited.every((c) => p.text.includes(c.quote));
            // Each quotation is judged on its own: one that was still in the
            // last capture and is gone now is a new disappearance, however
            // many others were already missing (and flagged) before.
            const newlyMissing = cited.some(
              (c) =>
                previous.text.includes(c.quote) && !p.text.includes(c.quote),
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
              ? `Source refreshed; ${affected.length} finding(s) need re-review`
              : "Source refreshed; no text change",
            source.id,
          );
          return { source, ...source.captureDiff };
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
        blob: f.buffer.toString("base64"),
        caption: String(req.body.caption || "").slice(0, 4000),
        runIds: [],
        error:
          !image && !content.trim()
            ? "No extractable text. Upload a text-readable document or record a passage manually."
            : undefined,
      };
      await mutate(req, res, (w, m) => {
        w.sources.push(source);
        audit(w, m.userId, "Source uploaded", source.id);
      });
      const { blob, ...clean } = source;
      res.status(201).json(clean);
    }),
  );
  app.get(
    "/api/sources/:id/file",
    handler(async (req, res) => {
      const s = get((await store.read()).sources, String(req.params.id));
      if (!s.blob) throw new HttpError(404, "No uploaded file.");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", s.mime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(s.filename || "source").replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      );
      res.send(Buffer.from(s.blob, "base64"));
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
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const s = get(w.sources, String(req.params.id));
          data.roleIds.forEach((id) => roleInOrg(w, s.orgId, id));
          touch(s, req.body.version);
          Object.assign(s, data);
          audit(w, m.userId, "Source permission or scope updated", s.id);
          const { blob, ...clean } = s;
          return clean;
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
          validateCitations(w.sources, orgId, data.kind, data.citations);
          const finding = {
            ...base(),
            ...data,
            orgId,
            review: "unreviewed" as const,
            runIds: [],
            history: [],
          };
          w.findings.push(finding);
          audit(w, m.userId, "Finding created", finding.id);
          return finding;
        }),
      );
    }),
  );
  app.patch(
    "/api/findings/:id",
    handler(async (req, res) => {
      const data = z
        .object({
          claim: z.string().min(1).max(8000),
          kind: z.enum(["company", "occupation", "proposal"]),
          review,
          rationale: optionalText,
        })
        .parse(req.body);
      res.json(
        await mutate(req, res, (w, m) => {
          const f = get(w.findings, String(req.params.id));
          validateCitations(w.sources, f.orgId, data.kind, f.citations);
          touch(f, req.body.version);
          f.history.push({
            at: now(),
            actor: m.userId,
            claim: f.claim,
            review: f.review,
            rationale: f.rationale,
          });
          Object.assign(f, data, { reviewer: m.userId, reviewedAt: now() });
          audit(w, m.userId, "Finding reviewed", f.id);
          return f;
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
              throw new HttpError(422, "Finding is outside this role.");
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
        })
        .parse(req.body);
      if (!providers()[data.tier])
        throw new HttpError(
          503,
          "The selected research tier is not configured. Add the provider keys in the server environment.",
        );
      res.status(202).json(
        await mutate(req, res, (w, m) => {
          const orgId = String(req.params.id);
          roleInOrg(w, orgId, data.roleId);
          const active = w.jobs.find(
            (j) =>
              j.orgId === orgId &&
              j.roleId === data.roleId &&
              ["queued", "researching"].includes(j.status),
          );
          if (active) return active;
          const job = {
            ...base(),
            ...data,
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
