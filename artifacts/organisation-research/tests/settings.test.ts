import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import request from "supertest";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import {
  processJob,
  researchReady,
  INSTRUCTIONS,
  OUTPUT_CONTRACT,
} from "../server/research.js";
import { researchModel } from "../server/models.js";
import { base } from "../server/domain.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import type { Workspace } from "../shared/types.js";

// Plan P1.4 (28 Oct 2026): one research model from the environment, the
// prompt kept in code, no tiers and no settings page.

let store: Store;
let fixture: Workspace;
const admin = { ...reviewer, userId: "user_admin", role: "admin" as const };
const asAdmin = () => createApp(store, { testMember: admin });

beforeAll(async () => {
  store = await Store.open();
  await store.init();
  fixture = sampleWorkspace();
  await store.transact((w) => Object.assign(w, fixture));
});
afterAll(async () => {
  await store.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("The research model", () => {
  it("takes RESEARCH_MODEL, falls back to POWER_MODEL, and never guesses", () => {
    expect(researchModel({})).toEqual({});
    expect(researchModel({ POWER_MODEL: "claude-sonnet-5" })).toEqual({
      model: "claude-sonnet-5",
      envVar: "POWER_MODEL",
      problem: undefined,
    });
    expect(
      researchModel({ RESEARCH_MODEL: "gemini-3-flash-preview", POWER_MODEL: "claude-sonnet-5" }).model,
    ).toBe("gemini-3-flash-preview");
    expect(researchModel({ RESEARCH_MODEL: "not a model id" }).problem).toContain(
      "not a valid model ID",
    );
  });

  it("is ready only with a usable model and its provider connected", () => {
    vi.stubEnv("RESEARCH_MODEL", "claude-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_INTEGRATIONS_ANTHROPIC_BASE_URL", "");
    expect(researchReady()).toBe(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    expect(researchReady()).toBe(true);
    vi.stubEnv("RESEARCH_MODEL", "gpt-test");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_INTEGRATIONS_OPENAI_BASE_URL", "");
    expect(researchReady()).toBe(false);
  });

  it("reports the model on the session and has no settings routes", async () => {
    vi.stubEnv("RESEARCH_MODEL", "claude-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const session = await request(asAdmin()).get("/api/session");
    expect(session.body.research).toEqual({ ready: true, model: "claude-test" });
    expect((await request(asAdmin()).get("/api/research-settings")).status).toBe(404);
    expect(
      (
        await request(asAdmin())
          .put("/api/research-settings/prompt")
          .send({ instructions: "Changed", version: 0 })
      ).status,
    ).toBe(404);
  });

  it("refuses to start research when no model is set", async () => {
    vi.stubEnv("RESEARCH_MODEL", "");
    vi.stubEnv("POWER_MODEL", "");
    const r = await request(asAdmin())
      .post(`/api/organisations/${fixture.organisations[0].id}/research`)
      .send({ roleId: fixture.roles[0].id });
    expect(r.status).toBe(503);
    expect(r.body.error).toContain("RESEARCH_MODEL");
  });

  it("sends the fixed instructions, then the output contract and the sources, in one call", async () => {
    vi.stubEnv("RESEARCH_MODEL", "claude-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const role = fixture.roles[0];
    const job = {
      ...base(),
      orgId: role.orgId,
      roleId: role.id,
      status: "researching" as const,
      stage: "Testing",
      errors: [],
      requestedBy: admin.userId,
      attempts: 1,
      runs: [],
    };
    await store.transact((w) => {
      w.jobs.push(job);
    });
    const sent: { model: string; content: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        sent.push({ model: body.model, content: body.messages[0].content });
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({ findings: [], questions: [] }),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 3 },
          }),
          { status: 200 },
        );
      }),
    );
    await processJob(store, job.id);
    const done = (await store.read()).jobs.find((j) => j.id === job.id)!;
    expect(sent).toHaveLength(1);
    expect(sent[0].model).toBe("claude-test");
    expect(sent[0].content.startsWith(INSTRUCTIONS)).toBe(true);
    expect(sent[0].content).toContain(OUTPUT_CONTRACT);
    expect(sent[0].content).toContain("SOURCES BEGIN");
    expect(done.runs).toHaveLength(1);
    expect(done.runs[0].status).toBe("completed");
    expect(done.tier).toBeUndefined();
    await store.transact((w) => {
      w.jobs = w.jobs.filter((j) => j.id !== job.id);
    });
  });
});
