import { it, expect, vi, afterEach, describe } from "vitest";
import { Store } from "../server/store.js";
import { processJob } from "../server/research.js";
import { sampleWorkspace } from "./fixtures.js";
import { base, now } from "../server/domain.js";
import type { Folder, ResearchJob, Section, Source, Workspace } from "../shared/types.js";

// Plan P1.5 (28 Oct 2026): one run researches every chosen section, one
// analysis per section in parallel, each reading its own folder first.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const folderText: Record<string, string> = {
  "01-organisation": "Northstar runs regional distribution centres for retail clients.",
  "02-role": "Coordinators check every inbound delivery against the purchase order.",
  "03-case-material": "A short delivery is held in the quarantine bay until it is resolved.",
};
const slotFor: Record<string, string> = {
  "01-organisation": "organisation.paragraph",
  "02-role": "role.title",
  "03-case-material": "case.routine",
};

function workspaceWithFolders() {
  const w = sampleWorkspace();
  const org = w.organisations[0];
  const role = w.roles[0];
  const sources: Source[] = Object.entries(folderText).map(([folder, text]) => ({
    ...base(),
    orgId: org.id,
    roleIds: folder === "01-organisation" ? [] : [role.id],
    title: `${folder} notes`,
    kind: "statement",
    url: "",
    text,
    locator: "Notes",
    permission: "research-only",
    verification: "user-supplied",
    suppliedBy: "Team",
    publishedAt: "",
    retrievedAt: now(),
    runIds: [],
    folder: folder as Folder,
  }));
  w.sources = sources;
  w.findings = [];
  return { w, org, role, sources };
}

function job(w: Workspace, sections: Section[]): ResearchJob {
  return {
    ...base(),
    orgId: w.organisations[0].id,
    roleId: w.roles[0].id,
    status: "researching",
    stage: "Testing",
    errors: [],
    requestedBy: "user_admin",
    attempts: 1,
    runs: [],
    sections,
    crawl: false,
  };
}

/** Answers each section's call with one fact from that section's own source. */
function modelBySection(sources: Source[], failFolder?: string, beforeAnswer?: () => Promise<void>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const prompt: string = JSON.parse(String(init.body)).messages[0].content;
      const places = prompt.slice(prompt.indexOf("Places to fill:"), prompt.indexOf("Slot vocabulary:"));
      const folder =
        places.includes("The role:") ? "02-role" : places.includes("Case material:") ? "03-case-material" : "01-organisation";
      calls.push(folder);
      if (beforeAnswer) await beforeAnswer();
      if (folder === failFolder) return new Response("Unavailable", { status: 503 });
      const source = sources.find((item) => item.folder === folder)!;
      const firstSourceInPrompt = prompt.slice(prompt.indexOf("SOURCES BEGIN")).match(/"title":"([^"]+)"/)?.[1];
      const finding = {
        claim: `${folder}: ${firstSourceInPrompt}`,
        kind: "company",
        citations: [{ sourceId: source.id, quote: source.text, locator: "Notes" }],
        rationale: "Test",
        slot: slotFor[folder],
      };
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({ findings: [finding], questions: [] }) }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200 },
      );
    }),
  );
  return calls;
}

describe("One Generate", () => {
  it("researches each chosen section in its own analysis and keeps the others when one fails", async () => {
    vi.stubEnv("RESEARCH_MODEL", "claude-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const store = await Store.open();
    await store.init();
    try {
      const { w, sources } = workspaceWithFolders();
      const j = job(w, ["organisation", "role", "case"]);
      w.jobs = [j];
      await store.transact((state) => Object.assign(state, w));
      const calls = modelBySection(sources, "03-case-material");

      await processJob(store, j.id);
      const result = await store.read();
      const done = result.jobs[0];

      expect(calls.sort()).toEqual(["01-organisation", "02-role", "03-case-material"]);
      expect(done.runs.map((run) => run.section).sort()).toEqual(["case", "organisation", "role"]);
      expect(done.runs.find((run) => run.section === "case")!.status).toBe("failed");
      expect(done.status).toBe("gaps");
      expect(done.errors.some((error) => error.startsWith("Case material: claude-test:"))).toBe(true);
      // Each analysis read its own folder first.
      expect(result.findings.map((f) => f.claim).sort()).toEqual([
        "01-organisation: 01-organisation notes",
        "02-role: 02-role notes",
      ]);
      expect(result.organisations[0].sectionStatus?.organisation?.stage).toBe("extracted");
      expect(result.roles[0].sectionStatus?.role?.stage).toBe("extracted");
      expect(result.roles[0].sectionStatus?.case?.stage).not.toBe("extracted");
    } finally {
      await store.close();
    }
  });

  it("writes nothing from any section once the run is cancelled", async () => {
    vi.stubEnv("RESEARCH_MODEL", "claude-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const store = await Store.open();
    await store.init();
    try {
      const { w, sources } = workspaceWithFolders();
      const j = job(w, ["organisation", "role", "case"]);
      w.jobs = [j];
      await store.transact((state) => Object.assign(state, w));
      modelBySection(sources, undefined, async () => {
        await store.transact((state) => {
          state.jobs[0].status = "cancelled";
        });
      });

      await processJob(store, j.id);
      const result = await store.read();
      expect(result.findings).toEqual([]);
      expect(result.jobs[0].status).toBe("cancelled");
    } finally {
      await store.close();
    }
  });
});
