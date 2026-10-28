import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import { base, now } from "../server/domain.js";
import type { Source, Workspace } from "../shared/types.js";

const page = { current: "" };
vi.mock("../server/retrieval.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/retrieval.js")>();
  return {
    ...actual,
    fetchPublic: async (url: string) => ({ url, html: page.current }),
  };
});

let store: Store;
let fixture: Workspace;
let webSource: Source;
const html = (body: string) =>
  `<html><head><title>Northstar careers</title></head><body><main>${body}</main></body></html>`;
const firstParagraph =
  "Our warehouse coordinators check every inbound delivery against the purchase order before it is booked in.";
const secondParagraph = "Shifts run from 06:00 to 14:00 and 14:00 to 22:00.";

beforeAll(async () => {
  store = await Store.open();
  await store.init();
  fixture = sampleWorkspace();
  const org = fixture.organisations[0];
  webSource = {
    ...base(),
    orgId: org.id,
    roleIds: [fixture.roles[0].id],
    title: "Northstar careers",
    kind: "web",
    url: "https://northstar.example/careers",
    text: `${firstParagraph}\n${secondParagraph}`,
    locator: "Captured page excerpt",
    permission: "research-only",
    verification: "public-source",
    suppliedBy: "Public website",
    publishedAt: "",
    retrievedAt: now(),
    runIds: [],
    folder: "02-role",
    tier: 2,
    tierReason: "Public careers page",
    rights: "reference-only",
    transcriptSourceId: fixture.sources[0].id,
    timecode: "00:00:30",
    providedBy: { name: "Jordan Lee", jobTitle: "Careers manager" },
  };
  fixture.sources.push(webSource);
  fixture.findings.push({
    ...base(),
    orgId: org.id,
    roleId: fixture.roles[0].id,
    kind: "company",
    claim: "Inbound deliveries are checked against the purchase order.",
    citations: [
      { sourceId: webSource.id, quote: firstParagraph, locator: "Paragraph 1" },
    ],
    review: "accepted",
    reviewer: reviewer.userId,
    reviewedAt: now(),
    rationale: "",
    runIds: [],
    history: [],
  });
  await store.transact((w) => Object.assign(w, fixture));
});
afterAll(async () => {
  await store.close();
});
const app = () => createApp(store, { testMember: reviewer });
const researcher = () =>
  createApp(store, { testMember: { ...reviewer, role: "researcher" } });
const role = () => fixture.roles[0];
const currentRole = async () =>
  (await request(app()).get("/api/workspace")).body.roles.find(
    (r: { id: string }) => r.id === role().id,
  );

describe("Likely organisation matches", () => {
  it("suggests existing organisations by name and domain with reasons", async () => {
    await request(app())
      .patch(`/api/organisations/${fixture.organisations[1].id}`)
      .send({
        ...fixture.organisations[1],
        website: "https://www.elmbridge.example/",
      });
    const byName = await request(app())
      .get("/api/organisations/suggest")
      .query({ name: "North Star Logistics Ltd", website: "" });
    expect(byName.status).toBe(200);
    expect(byName.body.suggestions[0].name).toBe("Northstar Logistics");
    expect(byName.body.suggestions[0].reasons).toContain("Similar spelling");
    const byDomain = await request(app())
      .get("/api/organisations/suggest")
      .query({
        name: "Totally different",
        website: "https://elmbridge.example/jobs",
      });
    expect(
      byDomain.body.suggestions.map((s: { name: string }) => s.name),
    ).toEqual(["Elmbridge Engineering"]);
    expect(byDomain.body.suggestions[0].reasons).toEqual([
      "Same website domain",
    ]);
    const none = await request(app())
      .get("/api/organisations/suggest")
      .query({ name: "Quantum Bakery", website: "" });
    expect(none.body.suggestions).toEqual([]);
  });
});

describe("Official occupational data", () => {
  it("describes the bundled datasets with version, licence and jurisdiction", async () => {
    const r = await request(app()).get("/api/occupations/datasets");
    expect(r.status).toBe(200);
    const schemes = r.body.datasets.map((d: { scheme: string }) => d.scheme);
    expect(schemes).toEqual(["UK SOC", "O*NET"]);
    for (const d of r.body.datasets) {
      expect(d.version).toMatch(/SOC 2020|O\*NET/);
      expect(d.licence).toMatch(/Open Government Licence|CC BY/);
      expect(["UK", "US"]).toContain(d.jurisdiction);
      expect(d.occupations).toBeGreaterThan(400);
    }
  });
  it("proposes deterministic candidates for a role with the matched terms as rationale", async () => {
    const r = await request(app()).get(
      `/api/roles/${role().id}/occupation-candidates`,
    );
    expect(r.status).toBe(200);
    const soc = r.body.candidates["UK SOC"];
    expect(soc[0].code).toBe("9252");
    expect(soc[0].title).toBe("Warehouse operatives");
    expect(soc[0].jurisdiction).toBe("UK");
    expect(soc[0].rationale).toMatch(/“warehouse”/);
    expect(
      soc[0].matchedTerms.some((m: { field: string }) => m.field === "title"),
    ).toBe(true);
    const onet = r.body.candidates["O*NET"];
    expect(onet[0].jurisdiction).toBe("US");
    expect(onet[0].rationale).toMatch(/US occupations/);
    expect(
      onet.every((c: { code: string }) => /^\d{2}-\d{4}\.\d{2}$/.test(c.code)),
    ).toBe(true);
    const again = await request(app()).get(
      `/api/roles/${role().id}/occupation-candidates`,
    );
    expect(again.body.candidates).toEqual(r.body.candidates);
  });
  it("searches by free text and returns full dataset entries", async () => {
    const s = await request(app())
      .get("/api/occupations/search")
      .query({ q: "care assistant", scheme: "UK SOC", limit: 3 });
    expect(s.status).toBe(200);
    expect(s.body.candidates["UK SOC"][0].code).toBe("6135");
    const e = await request(app())
      .get("/api/occupations/entry")
      .query({ scheme: "O*NET", code: "53-7065.00" });
    expect(e.status).toBe(200);
    expect(e.body.entry.title).toBe("Stockers and Order Fillers");
    expect(e.body.entry.tasks.length).toBeGreaterThan(5);
    expect(e.body.entry.activities[0]).toMatch(/\(\d\.\d\/5\)$/);
    expect(e.body.sourceUrl).toBe(
      "https://www.onetonline.org/link/summary/53-7065.00",
    );
    expect(e.body.dataset.jurisdiction).toBe("US");
    expect(
      (
        await request(app())
          .get("/api/occupations/entry")
          .query({ scheme: "UK SOC", code: "0000" })
      ).status,
    ).toBe(404);
  });
  it("records a dataset match on the role with basis, jurisdiction and retrieval time", async () => {
    const e = await request(app())
      .get("/api/occupations/entry")
      .query({ scheme: "UK SOC", code: "9252" });
    const r = await request(app())
      .post(`/api/roles/${role().id}/occupations`)
      .send({
        version: (await currentRole()).version,
        scheme: "UK SOC",
        code: "9252",
        title: e.body.entry.title,
        sourceUrl: e.body.sourceUrl,
        datasetVersion: e.body.dataset.version,
        rationale: "Keyword match confirmed against responsibilities.",
        basis: "dataset-search",
        jurisdiction: "UK",
        retrievedAt: e.body.dataset.retrievedAt,
        activities: e.body.entry.tasks.slice(0, 3),
      });
    expect(r.status).toBe(200);
    const saved = r.body.occupations.at(-1);
    expect(saved.basis).toBe("dataset-search");
    expect(saved.jurisdiction).toBe("UK");
    expect(saved.datasetVersion).toMatch(/SOC 2020/);
    expect(saved.activities).toHaveLength(3);
  });
});

describe("Simplified pack creation", () => {
  it("no longer offers role approval states (retired 28 Oct 2026)", async () => {
    const r = await request(researcher())
      .post(`/api/roles/${role().id}/review-state`)
      .send({ state: "in-review", version: (await currentRole()).version });
    expect(r.status).toBe(404);
  });
  it("creates the single pack without marking ready", async () => {
    const f = fixture.findings[0];
    expect(
      (
        await request(app())
          .patch(`/api/findings/${f.id}`)
          .send({ ...f, review: "accepted" })
      ).status,
    ).toBe(200);
    const pack = await request(app())
      .post(`/api/roles/${role().id}/packs`)
      .send({});
    expect(pack.status).toBe(201);
    expect(pack.body.status).toBe("ready");
  });
  it("still creates a pack after content changes", async () => {
    const org = fixture.organisations[0];
    expect(
      (
        await request(app())
          .patch(`/api/organisations/${org.id}`)
          .send({ ...org, version: 1, summary: "Edited after sign-off" })
      ).status,
    ).toBe(200);
    const pack = await request(app())
      .post(`/api/roles/${role().id}/packs`)
      .send({});
    expect(pack.status).toBe(201);
  });
});

describe("Pack limitations", () => {
  it("carries research-run errors into the pack", async () => {
    await store.transact((ws) => {
      ws.jobs.push({
        ...base(),
        orgId: fixture.organisations[0].id,
        roleId: role().id,
        tier: "economy",
        status: "completed",
        stage: "done",
        errors: ["Model call failed: simulated"],
        requestedBy: reviewer.userId,
        attempts: 1,
        runs: [],
      });
    });
    const pack = await request(app())
      .post(`/api/roles/${role().id}/packs`)
      .send({});
    expect(pack.status).toBe(201);
    expect(pack.body.limitations).toContain("Model call failed: simulated");
  });
  it("no longer offers source refresh (retired 28 Oct 2026)", async () => {
    const r = await request(app()).post(`/api/sources/${webSource.id}/refresh`);
    expect(r.status).toBe(404);
  });
});

describe("Dataset match integrity", () => {
  it("takes identity from the dataset, rejects foreign statements and forces proposed", async () => {
    const e = await request(app())
      .get("/api/occupations/entry")
      .query({ scheme: "O*NET", code: "53-7062.00" });
    expect(e.status).toBe(200);
    const forged = {
      scheme: "O*NET",
      code: "53-7062.00",
      title: "Chief Warehouse Strategist",
      sourceUrl: "https://example.com/not-the-dataset",
      datasetVersion: "O*NET 99.0",
      rationale: "Looks right.",
      status: "confirmed",
      basis: "dataset-search",
      jurisdiction: "UK",
      retrievedAt: "2030-01-01T00:00:00.000Z",
      skills: ["Telepathy"],
    };
    const rejected = await request(researcher())
      .post(`/api/roles/${role().id}/occupations`)
      .send({ ...forged, version: (await currentRole()).version });
    expect(rejected.status).toBe(422);
    const r = await request(researcher())
      .post(`/api/roles/${role().id}/occupations`)
      .send({
        ...forged,
        skills: e.body.entry.skills.slice(0, 2),
        version: (await currentRole()).version,
      });
    expect(r.status).toBe(200);
    const saved = r.body.occupations.at(-1);
    expect(saved.title).toBe(e.body.entry.title);
    expect(saved.sourceUrl).toBe(e.body.sourceUrl);
    expect(saved.datasetVersion).toBe(e.body.dataset.version);
    expect(saved.jurisdiction).toBe("US");
    expect(saved.retrievedAt).toBe(e.body.dataset.retrievedAt);
    expect(saved.status).toBe("proposed");
    expect(
      (
        await request(researcher())
          .post(`/api/roles/${role().id}/occupations`)
          .send({ ...forged, skills: [], version: r.body.version })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(researcher())
          .post(`/api/roles/${role().id}/occupations`)
          .send({
            ...forged,
            code: "53-0000.99",
            skills: [],
            version: r.body.version,
          })
      ).status,
    ).toBe(422);
    const confirmed = await request(researcher())
      .post(`/api/roles/${role().id}/occupations/status`)
      .send({
        scheme: "O*NET",
        code: "53-7062.00",
        status: "confirmed",
        version: r.body.version,
      });
    expect(confirmed.status).toBe(200);
    expect(
      confirmed.body.occupations.find(
        (o: { code: string }) => o.code === "53-7062.00",
      ).status,
    ).toBe("confirmed");
  });
});

describe("Occupational data in every pack (Ollie, 27 Oct 2026)", () => {
  type PackOccupation = {
    scheme: string;
    code: string;
    status: string;
    basis: string;
    jurisdiction: string;
    rationale: string;
    activities: string[];
  };
  const strings = (o: PackOccupation) =>
    Object.values(o).filter((v) => !Array.isArray(v));
  it("attaches the best UK SOC and O*NET matches with their tasks when none is recorded", async () => {
    const created = await request(app())
      .post(`/api/organisations/${fixture.organisations[0].id}/roles`)
      .send({
        title: "Warehouse operative",
        responsibilities: "Picks, packs and loads orders; checks deliveries.",
      });
    expect(created.status).toBe(201);
    const pack = await request(app())
      .post(`/api/roles/${created.body.id}/packs`)
      .send({});
    expect(pack.status).toBe(201);
    const occupations: PackOccupation[] = pack.body.role.occupations;
    expect(occupations.map((o) => o.scheme)).toEqual(["UK SOC", "O*NET"]);
    for (const o of occupations) {
      expect(o.status).toBe("proposed");
      expect(o.basis).toBe("dataset-search");
      expect(o.activities.length).toBeGreaterThan(0);
      expect(o.rationale).toMatch(/Attached automatically/);
      expect(strings(o).every((v) => v !== null)).toBe(true);
    }
    expect(occupations.map((o) => o.jurisdiction)).toEqual(["UK", "US"]);
    const json = await request(app()).get(`/api/packs/${pack.body.id}/json`);
    expect(JSON.parse(json.text).role.occupations).toEqual(occupations);
    // The snapshot carries the matches; the role record is left as it was.
    const saved = (await request(app()).get("/api/workspace")).body.roles.find(
      (r: { id: string }) => r.id === created.body.id,
    );
    expect(saved.occupations).toEqual([]);
  });
  it("keeps a recorded match and adds only the scheme the role lacks", async () => {
    const recorded: PackOccupation[] = (await currentRole()).occupations;
    expect(recorded.some((o) => o.scheme === "UK SOC")).toBe(true);
    const roleId = role().id;
    const withoutOnet = recorded.filter((o) => o.scheme !== "O*NET");
    await store.transact((w) => {
      w.roles.find((r) => r.id === roleId)!.occupations = withoutOnet as never;
    });
    const pack = await request(app()).post(`/api/roles/${roleId}/packs`).send({});
    expect(pack.status).toBe(201);
    const occupations: PackOccupation[] = pack.body.role.occupations;
    expect(occupations.filter((o) => o.scheme === "UK SOC")).toEqual(
      withoutOnet.filter((o) => o.scheme === "UK SOC"),
    );
    const onet = occupations.filter((o) => o.scheme === "O*NET");
    expect(onet).toHaveLength(1);
    expect(onet[0].rationale).toMatch(/Attached automatically/);
  });
});
