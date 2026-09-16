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
  DEFAULT_INSTRUCTIONS,
  OUTPUT_CONTRACT,
} from "../server/research.js";
import { base } from "../server/domain.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import type { Workspace } from "../shared/types.js";

let store: Store;
let fixture: Workspace;
const admin = { ...reviewer, userId: "user_admin", role: "admin" as const };
const asAdmin = () => createApp(store, { testMember: admin });
const asReviewer = () => createApp(store, { testMember: reviewer });

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

describe("Research settings", () => {
  it("shows environment defaults and lets an administrator change a verified model", async () => {
    vi.stubEnv("POWER_MODEL", "claude-env");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const before = await request(asReviewer()).get("/api/research-settings");
    expect(before.status).toBe(200);
    const power = before.body.slots.find((s: any) => s.slot === "power");
    expect(power).toMatchObject({
      model: "claude-env",
      source: "environment",
      provider: "anthropic",
    });
    expect(before.body.tiers.power).toBe(true);
    expect(before.body.prompt).toMatchObject({ version: 0, isDefault: true });

    // Only administrators change models.
    expect(
      (
        await request(asReviewer())
          .put("/api/research-settings/models/power")
          .send({ model: "claude-sonnet-5" })
      ).status,
    ).toBe(403);
    // A model that belongs to a different provider is refused outright.
    const wrong = await request(asAdmin())
      .put("/api/research-settings/models/power")
      .send({ model: "gpt-5.6-terra" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toContain("OpenAI");

    // The chosen model must answer a live request before it is stored.
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push(body.model);
        return body.model === "claude-broken"
          ? new Response("Not found", { status: 404 })
          : new Response(
              JSON.stringify({
                content: [{ type: "text", text: '{"ok":true}' }],
                usage: { input_tokens: 10, output_tokens: 3 },
              }),
              { status: 200 },
            );
      }),
    );
    const broken = await request(asAdmin())
      .put("/api/research-settings/models/power")
      .send({ model: "claude-broken" });
    expect(broken.status).toBe(422);
    expect(broken.body.error).toContain("did not answer");
    expect((await store.read()).settings?.models.power).toBeUndefined();

    const changed = await request(asAdmin())
      .put("/api/research-settings/models/power")
      .send({ model: "claude-sonnet-5" });
    expect(changed.status).toBe(200);
    expect(calls).toEqual(["claude-broken", "claude-sonnet-5"]);
    expect(
      changed.body.slots.find((s: any) => s.slot === "power"),
    ).toMatchObject({ model: "claude-sonnet-5", source: "workspace" });
    const w = await store.read();
    expect(w.settings?.models.power).toBe("claude-sonnet-5");
    expect(
      w.audit.some(
        (a) =>
          a.actor === admin.userId &&
          a.action.includes("claude-env → claude-sonnet-5"),
      ),
    ).toBe(true);

    // Back to the environment default without a probe.
    const reset = await request(asAdmin())
      .put("/api/research-settings/models/power")
      .send({ model: "" });
    expect(reset.status).toBe(200);
    expect(reset.body.slots.find((s: any) => s.slot === "power")).toMatchObject(
      { model: "claude-env", source: "environment" },
    );
    expect(calls).toHaveLength(2);
  });

  it("does not treat a tier as ready when the environment default belongs to another provider", async () => {
    vi.stubEnv("ECONOMY_MODEL", "gpt-5-mini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const r = await request(asReviewer()).get("/api/research-settings");
    expect(r.status).toBe(200);
    expect(r.body.tiers.economy).toBe(false);
    const economy = r.body.slots.find((s: any) => s.slot === "economy");
    expect(economy.model).toBe("gpt-5-mini");
    expect(economy.problem).toContain("OpenAI");
    // Clearing an override cannot fall back to an unusable default either.
    const cleared = await request(asAdmin())
      .put("/api/research-settings/models/economy")
      .send({ model: "" });
    expect(cleared.status).toBe(422);
  });

  it("versions prompt edits, rejects stale saves and records the version on research runs", async () => {
    vi.stubEnv("POWER_MODEL", "claude-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    expect(
      (
        await request(asReviewer())
          .put("/api/research-settings/prompt")
          .send({ instructions: "Changed", version: 0 })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(asAdmin())
          .put("/api/research-settings/prompt")
          .send({ instructions: "   ", version: 0 })
      ).status,
    ).toBe(422);
    const custom = `${DEFAULT_INSTRUCTIONS}\nAlways note the shift pattern.`;
    const saved = await request(asAdmin())
      .put("/api/research-settings/prompt")
      .send({ instructions: custom, version: 0 });
    expect(saved.status).toBe(200);
    expect(saved.body.prompt).toMatchObject({
      version: 1,
      isDefault: false,
      updatedBy: admin.userId,
      instructions: custom,
    });
    // A save based on the version before this edit is refused.
    expect(
      (
        await request(asAdmin())
          .put("/api/research-settings/prompt")
          .send({ instructions: "Another edit", version: 0 })
      ).status,
    ).toBe(409);

    // The worker sends the saved instructions followed by the fixed contract.
    const role = fixture.roles[0];
    const job = {
      ...base(),
      orgId: role.orgId,
      roleId: role.id,
      tier: "power" as const,
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
    let sent = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body)).messages[0].content;
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  findings: [],
                  questions: [],
                  activities: [
                    {
                      title: "Ignored while parked",
                      action: "x",
                      output: "x",
                      materials: "x",
                      learning: "x",
                      confirmation: "x",
                      findingIndexes: [],
                    },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 3 },
          }),
          { status: 200 },
        );
      }),
    );
    await processJob(store, job.id);
    const after = await store.read();
    const done = after.jobs.find((j) => j.id === job.id)!;
    expect(done.promptVersion).toBe(1);
    expect(sent.startsWith(custom)).toBe(true);
    expect(sent).toContain(OUTPUT_CONTRACT);
    expect(sent).toContain("SOURCES BEGIN");
    expect(done.runs[0].status).toBe("completed");
    // Activity candidates are parked: returned proposals are not stored.
    expect(
      after.activities.some((a) => a.title === "Ignored while parked"),
    ).toBe(false);

    // Reset keeps the version moving so old runs stay attributable.
    const reset = await request(asAdmin())
      .put("/api/research-settings/prompt")
      .send({ reset: true, version: 1 });
    expect(reset.status).toBe(200);
    expect(reset.body.prompt).toMatchObject({
      version: 2,
      isDefault: true,
      instructions: DEFAULT_INSTRUCTIONS,
    });
    await store.transact((w) => {
      w.jobs = w.jobs.filter((j) => j.id !== job.id);
    });
  });
});
