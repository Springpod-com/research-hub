/**
 * Studio's research pack parser schema, copied verbatim from Springpod Studio
 * `lib/mechanics-content/src/research-pack.ts` (commit f30a95a, branch
 * claude/blissful-johnson-y0m1of, 28 Oct 2026). Studio refuses any pack this
 * schema refuses, so every export here must pass it (plan P0.2). When Studio
 * changes its parser, copy it again.
 */
import { z } from "zod";

/**
 * Research pack: the organisation knowledge base produced by the separate
 * Organisation Research app (knowledge-base.json, schemaVersion 2.x). Studio
 * consumes it as a grounding source for storyboard and activity drafts; it
 * never edits it. The schema is owned by that app, so parsing is tolerant of
 * unknown keys and only the fields Studio relies on are required.
 */

export const RESEARCH_PACK_SCHEMA_MAJOR = 2;
export const RESEARCH_PACK_FILE_NAME = "knowledge-base.json";

const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const citationSchema = z
  .object({
    quote: z.string().default(""),
    locator: z.string().default(""),
    sourceId: z.string().default(""),
  })
  .passthrough();

const findingSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().default("unknown"),
    slot: z.string().default("none"),
    tier: tierSchema,
    claim: z.string().min(1),
    review: z.string().default("unreviewed"),
    citations: z.array(citationSchema).default([]),
  })
  .passthrough();

const sourceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().default("document"),
    title: z.string().default(""),
    filename: z.string().default(""),
    folder: z.string().default(""),
    url: z.string().default(""),
    tier: tierSchema.optional(),
  })
  .passthrough();

const registerEntrySchema = z
  .object({
    n: z.number().int().positive(),
    slot: z.string().default("none"),
    tier: tierSchema,
    claim: z.string().min(1),
    verified: z.boolean().default(false),
    findingId: z.string().default(""),
    sourceIds: z.array(z.string()).default([]),
  })
  .passthrough();

/** Free text in the pack may arrive as a newline-separated string or a list. */
const lines = z
  .union([z.string(), z.array(z.string())])
  .default("")
  .transform((v) =>
    (Array.isArray(v) ? v : v.split(/\r?\n/)).map((line) => line.trim()).filter((line) => line.length > 0),
  );

/**
 * An occupational match from official datasets (UK SOC from the ONS, O*NET
 * from the US). It describes the occupation in general, never the employer;
 * `activities` holds the dataset's task statements.
 */
const occupationSchema = z
  .object({
    scheme: z.string().default(""),
    code: z.string().default(""),
    title: z.string().default(""),
    jurisdiction: z.string().default(""),
    status: z.string().default(""),
    activities: z.array(z.string()).default([]),
  })
  .passthrough();

/** Tasks per occupation carried into prompts. */
const OCCUPATION_TASKS_MAX = 15;

const questionSchema = z
  .object({ id: z.string().default(""), text: z.string().min(1), why: z.string().default("") })
  .passthrough();

export const knowledgeBaseSchema = z
  .object({
    schemaVersion: z.string().regex(/^2\.\d+\.\d+$/, "Unsupported knowledge base schema version"),
    id: z.string().min(1),
    status: z.string().default("draft"),
    revision: z.number().int().nonnegative().default(0),
    header: z
      .object({
        role: z.string().default(""),
        organisation: z.string().default(""),
        compiledBy: z.string().default(""),
        factChecker: z.string().default(""),
        lastUpdated: z.string().default(""),
      })
      .passthrough()
      .default({}),
    organisation: z
      .object({
        name: z.string().min(1),
        summary: z.string().default(""),
        website: z.string().default(""),
        country: z.string().default(""),
        mayUse: lines,
        mustNotSay: lines,
        brandNotes: z.string().default(""),
      })
      .passthrough(),
    role: z
      .object({
        title: z.string().min(1),
        seniority: z.string().default(""),
        location: z.string().default(""),
        responsibilities: lines,
        boundaries: lines,
        // Ignored before 27 Oct 2026, so a malformed list must not refuse a pack that imported then.
        occupations: z.array(occupationSchema).default([]).catch([]),
      })
      .passthrough(),
    tiers: z.record(z.string(), z.string()).default({}),
    findings: z.array(findingSchema).default([]),
    sources: z.array(sourceSchema).default([]),
    register: z.array(registerEntrySchema).default([]),
    toConfirm: z.array(z.object({ claim: z.string().min(1) }).passthrough()).default([]),
    questions: z.array(questionSchema).default([]),
    limitations: z.array(z.string()).default([]),
    employerApproval: z.boolean().default(false),
  })
  .passthrough();

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
