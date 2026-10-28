import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { processJob } from "../server/research.js";
import { base } from "../server/domain.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import { knowledgeBaseSchema } from "./studio-contract.js";
import type { Workspace } from "../shared/types.js";

// Entry routes and programmes (Ollie, 28 Oct 2026): a role can be a
// programme such as a degree apprenticeship, with placements, and the
// research and the pack follow it.

let store: Store;
let fixture: Workspace;
beforeAll(async () => {
  store = await Store.open();
  await store.init();
  fixture = sampleWorkspace();
  fixture.sources.push({
    ...fixture.sources[0],
    ...base(),
    roleIds: [],
    title: "Apprenticeships page",
    text: "Our logistics degree apprenticeship rotates through goods-in, transport planning and customer operations.",
  });
  await store.transact((w) => Object.assign(w, fixture));
});
afterAll(async () => {
  await store.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const app = () => createApp(store, { testMember: reviewer });
const org = () => fixture.organisations[0];
const placesIn = (body: { sections: { section: string; slots: { slot: string }[] }[] }) =>
  body.sections.find((section) => section.section === "role")!.slots.map((slot) => slot.slot);

describe("Programme roles", () => {
  let programmeId = "";

  it("records a programme with its placements and offers programme places only for it", async () => {
    const created = await request(app())
      .post(`/api/organisations/${org().id}/roles`)
      .send({
        kind: "programme",
        title: "Logistics degree apprenticeship",
        responsibilities: "Four years of work and study across the business.",
        placements: ["Goods-in team", "Transport planning", "Customer operations"],
      });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe("programme");
    expect(created.body.placements).toEqual(["Goods-in team", "Transport planning", "Customer operations"]);
    programmeId = created.body.id;

    const programme = await request(app()).get(`/api/orgs/${org().id}/sections`).query({ roleId: programmeId });
    expect(placesIn(programme.body)).toEqual(expect.arrayContaining(["role.structure", "role.placements"]));
    const job = await request(app()).get(`/api/orgs/${org().id}/sections`).query({ roleId: fixture.roles[0].id });
    expect(placesIn(job.body)).not.toContain("role.placements");
    expect(placesIn(job.body)).not.toContain("role.structure");
  });

  it("tells the model it is a programme and offers its places", async () => {
    vi.stubEnv("RESEARCH_MODEL", "claude-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        prompts.push(JSON.parse(String(init.body)).messages[0].content);
        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: JSON.stringify({ findings: [], questions: [] }) }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        );
      }),
    );
    const run = async (roleId: string) => {
      const job = {
        ...base(),
        orgId: org().id,
        roleId,
        status: "researching" as const,
        stage: "Testing",
        errors: [],
        requestedBy: reviewer.userId,
        attempts: 1,
        runs: [],
        crawl: false,
      };
      await store.transact((w) => {
        w.jobs.push(job);
      });
      await processJob(store, job.id);
      await store.transact((w) => {
        w.jobs = w.jobs.filter((item) => item.id !== job.id);
      });
      return prompts.at(-1)!;
    };
    const programmePrompt = await run(programmeId);
    expect(programmePrompt).toContain('"kind":"programme"');
    expect(programmePrompt).toContain("Goods-in team");
    expect(programmePrompt).toContain('"slot":"role.placements"');
    expect(programmePrompt).toContain("When the role brief's kind is programme");
    const jobPrompt = await run(fixture.roles[0].id);
    expect(jobPrompt).not.toContain('"slot":"role.placements"');
  });

  it("carries the kind and placements in a pack Studio still imports", async () => {
    const pack = await request(app()).post(`/api/roles/${programmeId}/packs`).send({});
    expect(pack.status).toBe(201);
    expect(pack.body.role.kind).toBe("programme");
    expect(pack.body.role.placements).toEqual(["Goods-in team", "Transport planning", "Customer operations"]);
    expect(placesIn(pack.body)).toContain("role.placements");
    const parsed = knowledgeBaseSchema.safeParse(pack.body);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    const markdown = (await request(app()).get(`/api/packs/${pack.body.id}/md`)).text;
    expect(markdown).toContain(
      "**Entry route or programme.** Placements: Goods-in team; Transport planning; Customer operations.",
    );
    expect(markdown).toContain("### Roles and placements on the programme");
  });

  it("keeps existing roles as jobs", async () => {
    const pack = await request(app()).post(`/api/roles/${fixture.roles[0].id}/packs`).send({});
    expect(pack.body.role.kind).toBeUndefined();
    expect(placesIn(pack.body)).not.toContain("role.placements");
  });
});
