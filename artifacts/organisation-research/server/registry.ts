/**
 * Springpod App Registry: the deploy heartbeat.
 *
 * Every production start (which is every publish) posts a descriptive
 * profile of this app to the registry so that Springpod can see what runs,
 * on what, and with which data flows. The profile is built from the
 * allow-listed fields only — description, purpose, tech stack, API routes,
 * dependencies, a data-model summary, key decisions, integrations, data
 * flows and governance notes — and never includes source code, secrets,
 * environment values, database contents or user data.
 *
 * The registry key (`REGISTRY_API_KEY`) is read from the environment and
 * sent only as the `X-Registry-Key` header. It is never logged or exported.
 *
 * Fields, the tier vocabulary and the "unknown field" rule were confirmed
 * against the registry's own validation on 2026-09-24; see
 * `docs/app-registry.md` for the contract, the tier reasoning and the
 * MCP-dependent steps (classification, checks, contract version).
 */
import { createRequire } from "node:module";
import type { Express } from "express";

export const registryUrl = "https://app-registry.springpod.com";
export const heartbeatUrl = `${registryUrl}/api/heartbeat`;

export type RegistryTier = "Green" | "Yellow" | "Orange" | "Red";
export const registryTiers: RegistryTier[] = ["Green", "Yellow", "Orange", "Red"];

/** The exact heartbeat shape the registry accepts; any other key is rejected. */
export interface Heartbeat {
  tier: RegistryTier;
  description: string;
  purpose: string;
  techStack: string[];
  apiRoutes: string[];
  dependencies: string[];
  dataModel: string;
  keyDecisions: string[];
  integrations: string[];
  dataFlows: string[];
  governanceNotes: string;
}
export const heartbeatFields: (keyof Heartbeat)[] = [
  "tier",
  "description",
  "purpose",
  "techStack",
  "apiRoutes",
  "dependencies",
  "dataModel",
  "keyDecisions",
  "integrations",
  "dataFlows",
  "governanceNotes",
];

/**
 * Security tier as registered with the App Registry (the registration form
 * and `classify_project` must agree; see docs/app-registry.md). It is a fact
 * about the app, not a deployment setting, so it lives here rather than in
 * the environment. While it is unknown the heartbeat refuses to guess.
 */
export const registeredTier: RegistryTier | undefined = undefined;

interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
}
const readPackage = (): PackageManifest =>
  createRequire(import.meta.url)("../package.json") as PackageManifest;

/** `METHOD /path` for every route registered on the Express app, in order. */
export function routesOf(app: Express): string[] {
  const router = (app as unknown as { router?: { stack?: Layer[] } }).router;
  const routes: string[] = [];
  for (const layer of router?.stack || []) {
    if (!layer.route) continue;
    const methods = Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => method.toUpperCase())
      .sort();
    for (const path of ([] as string[]).concat(layer.route.path))
      routes.push(`${methods.join("|")} ${path}`);
  }
  return routes;
}
interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
}

const v = (deps: Record<string, string>, name: string) =>
  deps[name] ? ` ${deps[name]}` : "";

/** The descriptive profile the registry receives. Pure: safe to print. */
export function buildHeartbeat(
  app: Express,
  tier: RegistryTier | undefined = registeredTier,
  pkg: PackageManifest = readPackage(),
): Heartbeat {
  if (!tier)
    throw new Error(
      "The registered tier is not set (registeredTier in server/registry.ts must be Green, Yellow, Orange or Red); see docs/app-registry.md.",
    );
  const deps = pkg.dependencies || {};
  return {
    tier,
    description:
      "Organisation Research: a Springpod staff workspace that turns public web pages, uploaded documents and organisation-supplied statements into an evidence-backed organisation and role knowledge base, exported as Markdown, DOCX and a folder ZIP.",
    purpose:
      "Give programme designers verified, source-cited facts about an organisation and a role before they write a virtual work experience, with every fact traceable to a captured quotation and every source listed.",
    techStack: [
      "TypeScript",
      `Node.js (tsx${v(deps, "tsx")})`,
      `Express${v(deps, "express")}`,
      `React${v(deps, "react")}`,
      `Vite${v(deps, "vite")}`,
      "Tailwind CSS 4",
      `@springpod/design-system${v(deps, "@springpod/design-system")}`,
      "PostgreSQL (Replit-managed) in production; PGlite locally",
      `Clerk (Replit-managed tenant, @clerk/express${v(deps, "@clerk/express")})`,
      "Vitest and supertest",
      "ClamAV daemon as an upload-scanning sidecar",
      "Replit Reserved VM, single process",
    ],
    apiRoutes: routesOf(app),
    dependencies: Object.entries(deps)
      .map(([name, version]) => `${name}@${version}`)
      .sort(),
    dataModel:
      "PostgreSQL, three tables created by the app: research_workspace (one JSON document holding organisations, roles, sources, facts with citations, questions, activities, research jobs, members and an audit trail), research_packs (immutable knowledge-base snapshots, protected by a trigger) and research_files (uploaded bytes with the scanner verdict). Occupational reference data (UK SOC 2020, O*NET) is bundled JSON loaded in memory.",
    keyDecisions: [
      "One Express process on a Reserved VM serves the frontend, the API and the embedded research worker, so runs continue between requests.",
      "Every fact must quote its source verbatim; the server verifies the quotation against the captured text and derives an evidence tier (1 organisation-confirmed to 4 uncited).",
      "Facts are registered by default once the quotation check passes; people only exclude or restore them, and exports are always available.",
      "Knowledge-base packs are immutable snapshots; corrections create a new revision.",
      "Uploads are scanned before use and refused when the scanner is unavailable (fail closed); ZIP archives are scanned entry by entry with size and count limits.",
      "Bulk bytes stay out of the workspace document to keep reads and saves small.",
      "Model IDs for extraction come from configuration, never defaults; the model is asked only to quote, place and structure, never to rate reliability.",
      "British English throughout, enforced by the design-system audit in the production build.",
    ],
    integrations: [
      "Clerk (Replit-managed tenant): sign-in, session cookies and workspace roles (researcher, reviewer, admin)",
      "Replit AI Integrations proxy: Anthropic, OpenAI and Gemini models for fact extraction",
      "Replit PostgreSQL: application database",
      "ClamAV: local upload scanning sidecar",
      "ONS SOC 2020 (OGL v3) and O*NET (CC BY 4.0): bundled occupational datasets",
      "Springpod App Registry: deploy heartbeat and feedback",
    ],
    dataFlows: [
      "Browser (signed-in Springpod staff) to the same-origin Express API over HTTPS; Clerk validates every session.",
      "Server to public web pages named by staff: fetched server-side for capture; private, loopback and reserved addresses are refused.",
      "Server to the Replit AI Integrations proxy: captured source text and the research brief; results are quotations checked against the source.",
      "Staff uploads (PDF, DOCX, text, images, ZIP of images) to the ClamAV sidecar, then to PostgreSQL research_files.",
      "Server to the browser: Markdown, DOCX and ZIP exports of immutable packs.",
      "Server to the Springpod App Registry: this descriptive heartbeat on production start-up; no code, secrets, data or user information.",
      "No Springpod data-warehouse access and no learner data.",
    ],
    governanceNotes:
      "Internal staff tool; every route except health and public configuration requires a Clerk session and an active workspace membership with a role. Data held: material about partner organisations gathered for programme design (public pages, supplied documents, statements) and the names and job titles of organisation contacts who supply statements; no learner or candidate data. Every edit is written to an audit trail; packs cannot be altered after creation. Rate limiting, Helmet headers and a bounded upload size protect the API. All credentials and model IDs come from Replit Secrets. This heartbeat is generated from the running app and contains no secret or environment value.",
  };
}

export interface SendOptions {
  key?: string;
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** POST the heartbeat. Resolves with the registry's reply; rejects on any failure. */
export async function sendHeartbeat(
  heartbeat: Heartbeat,
  options: SendOptions = {},
): Promise<unknown> {
  const key = options.key ?? process.env.REGISTRY_API_KEY;
  if (!key) throw new Error("REGISTRY_API_KEY is not set.");
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(options.url ?? heartbeatUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Registry-Key": key },
    body: JSON.stringify(heartbeat),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `Registry heartbeat rejected (${response.status}): ${body.slice(0, 500)}`,
    );
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/**
 * Production start-up hook. The registry must never take the app down: every
 * failure is logged once and the app carries on serving.
 */
export async function reportDeploy(
  app: Express,
  options: SendOptions & {
    tier?: RegistryTier;
    log?: Pick<Console, "log" | "warn">;
  } = {},
): Promise<boolean> {
  const log = options.log ?? console;
  if (!(options.key ?? process.env.REGISTRY_API_KEY)) {
    log.warn(
      "[registry] REGISTRY_API_KEY is not set; the deploy heartbeat was not sent.",
    );
    return false;
  }
  try {
    const heartbeat = buildHeartbeat(app, options.tier ?? registeredTier);
    await sendHeartbeat(heartbeat, options);
    log.log(
      `[registry] deploy heartbeat sent (${heartbeat.tier}, ${heartbeat.apiRoutes.length} routes).`,
    );
    return true;
  } catch (error) {
    log.warn(
      `[registry] deploy heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
