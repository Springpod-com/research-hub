import { it, expect, vi, afterEach } from "vitest";
import { Store } from "../server/store.js";
import { processJob } from "../server/research.js";
import { sampleWorkspace } from "./fixtures.js";
import { base } from "../server/domain.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("retains one successful Max run when the second provider fails, excluding invented quotations", async () => {
  vi.stubEnv("MAX_CLAUDE_MODEL", "claude-test");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("MAX_OPENAI_MODEL", "gpt-test");
  const store = await Store.open();
  await store.init();
  const w = sampleWorkspace();
  const role = w.roles[0];
  const source = w.sources[0];
  const job = {
    ...base(),
    orgId: role.orgId,
    roleId: role.id,
    tier: "max" as const,
    status: "researching" as const,
    stage: "Testing",
    errors: [],
    requestedBy: "user_admin",
    attempts: 1,
    runs: [],
    sections: ["role"] as ("role")[],
  };
  w.jobs.push(job);
  await store.transact((state) => Object.assign(state, w));
  const data = {
    findings: [
      {
        claim: "Valid new finding",
        kind: "company",
        citations: [
          {
            sourceId: source.id,
            quote:
              "Coordinators record quantity differences and prepare a handover for the next shift.",
            locator: "Paragraph 1",
          },
        ],
        rationale: "Test",
      },
      {
        claim: "Invented claim",
        kind: "company",
        citations: [
          {
            sourceId: source.id,
            quote: "These words do not exist.",
            locator: "Paragraph 1",
          },
        ],
        rationale: "Test",
      },
      {
        claim: "Keep this claim",
        kind: "company",
        citations: [
          {
            sourceId: source.id,
            quote:
              "Coordinators record quantity differences and prepare a handover for the next shift.",
            locator: "Paragraph 1",
          },
        ],
        rationale: "Test",
        slot: "role.duty",
        fields: { duty: "A duty", unknown: "not a column" },
      },
      {
        claim: "Keep this finding without its fabricated source field",
        kind: "company",
        citations: [
          {
            sourceId: source.id,
            quote:
              "Coordinators record quantity differences and prepare a handover for the next shift.",
            locator: "Paragraph 1",
          },
        ],
        rationale: "Test",
        slot: "role.advert",
        fields: { title: "Coordinator", fileSourceId: "fabricated-source" },
      },
      {
        claim: "Brand claim outside the requested folder",
        kind: "company",
        citations: [
          {
            sourceId: source.id,
            quote:
              "Coordinators record quantity differences and prepare a handover for the next shift.",
            locator: "Paragraph 1",
          },
        ],
        rationale: "Test",
        slot: "brand.logo",
      },
    ],
    questions: [],
    activities: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("anthropic")
        ? new Response(
            JSON.stringify({
              content: [{ type: "text", text: JSON.stringify(data) }],
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
            { status: 200 },
          )
        : new Response("Unavailable", { status: 503 }),
    ),
  );
  try {
    await processJob(store, job.id);
    const result = await store.read();
    expect(result.jobs[0].status).toBe("gaps");
    expect(result.jobs[0].runs.map((r) => r.status).sort()).toEqual([
      "completed",
      "failed",
    ]);
    expect(result.findings.some((f) => f.claim === "Valid new finding")).toBe(
      true,
    );
    expect(result.findings.some((f) => f.claim === "Invented claim")).toBe(
      false,
    );
    const retained = result.findings.find((f) => f.claim === "Keep this claim");
    expect(retained?.slot).toBe("role.duty");
    expect(retained?.fields).toBeUndefined();
    const badReference = result.findings.find(
      (f) =>
        f.claim === "Keep this finding without its fabricated source field",
    );
    expect(badReference?.slot).toBe("role.advert");
    expect(badReference?.fields).toBeUndefined();
    const outside = result.findings.find(
      (f) => f.claim === "Brand claim outside the requested folder",
    );
    expect(outside?.slot).toBe("none");
    expect(result.jobs[0].errors).toContain(
      "Fact placed outside the requested folders: brand.logo → left unplaced",
    );
    expect(result.jobs[0].errors.some((e) => e.includes("excluded"))).toBe(
      true,
    );
    expect(result.sources).toHaveLength(1);
  } finally {
    await store.close();
  }
});
