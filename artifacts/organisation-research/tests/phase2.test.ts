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

describe("Pack review state", () => {
  it("lets researchers send for review but not mark ready", async () => {
    const r = await request(researcher())
      .post(`/api/roles/${role().id}/review-state`)
      .send({ state: "in-review", version: (await currentRole()).version });
    expect(r.status).toBe(200);
    expect(r.body.reviewState).toBe("in-review");
    expect(
      (
        await request(researcher())
          .post(`/api/roles/${role().id}/review-state`)
          .send({ state: "ready", version: (await currentRole()).version })
      ).status,
    ).toBe(403);
  });
  it("blocks ready until readiness passes, then gates ready snapshots on it", async () => {
    const blocked = await request(app())
      .post(`/api/roles/${role().id}/review-state`)
      .send({ state: "ready", version: (await currentRole()).version });
    expect(blocked.status).toBe(422);
    const f = fixture.findings[0];
    const a = fixture.activities[0];
    expect(
      (
        await request(app())
          .patch(`/api/findings/${f.id}`)
          .send({ ...f, review: "accepted" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .patch(`/api/activities/${a.id}`)
          .send({ ...a, review: "accepted" })
      ).status,
    ).toBe(200);
    // Readiness passes, but the profile has not been marked ready yet.
    const early = await request(app())
      .post(`/api/roles/${role().id}/packs`)
      .send({ status: "ready" });
    expect(early.status).toBe(422);
    expect(early.body.error).toMatch(/Mark the role profile ready/);
    const ready = await request(app())
      .post(`/api/roles/${role().id}/review-state`)
      .send({ state: "ready", version: (await currentRole()).version });
    expect(ready.status).toBe(200);
    expect(ready.body.reviewState).toBe("ready");
    const pack = await request(app())
      .post(`/api/roles/${role().id}/packs`)
      .send({ status: "ready" });
    expect(pack.status).toBe(201);
    expect(pack.body.role.reviewState).toBe("ready");
  });
  it("returns a ready profile to draft when reviewed content changes", async () => {
    const org = fixture.organisations[0];
    expect(
      (
        await request(app())
          .patch(`/api/organisations/${org.id}`)
          .send({ ...org, version: 1, summary: "Edited after sign-off" })
      ).status,
    ).toBe(200);
    const r = await currentRole();
    expect(r.reviewState).toBe("draft");
    expect(r.reviewChanged).toBe(true);
    const pack = await request(app())
      .post(`/api/roles/${role().id}/packs`)
      .send({ status: "ready" });
    expect(pack.status).toBe(422);
    expect(
      (
        await request(app())
          .post(`/api/roles/${role().id}/packs`)
          .send({ status: "draft" })
      ).status,
    ).toBe(201);
  });
});

describe("Source refresh", () => {
  it("keeps the old capture, links the new one and flags findings whose quote disappeared", async () => {
    page.current = html(
      `<p>Our warehouse coordinators now check every inbound delivery against the purchase order and the ASN.</p><p>${secondParagraph}</p><p>New: apprenticeships open in March.</p>`,
    );
    const r = await request(app()).post(`/api/sources/${webSource.id}/refresh`);
    expect(r.status).toBe(201);
    expect(r.body.changed).toBe(true);
    expect(r.body.source.supersedes).toBe(webSource.id);
    expect(r.body.source).toMatchObject({
      folder: webSource.folder,
      tier: webSource.tier,
      tierReason: webSource.tierReason,
      rights: webSource.rights,
      transcriptSourceId: webSource.transcriptSourceId,
      timecode: webSource.timecode,
      providedBy: webSource.providedBy,
    });
    expect(r.body.added).toContain("New: apprenticeships open in March.");
    expect(r.body.removed).toContain(firstParagraph);
    const flagged = fixture.findings.find(
      (f) => f.citations[0]?.sourceId === webSource.id,
    )!;
    expect(r.body.affectedFindingIds).toEqual([flagged.id]);
    const w = (await request(app()).get("/api/workspace")).body;
    const previous = w.sources.find((s: Source) => s.id === webSource.id);
    expect(previous.supersededBy).toBe(r.body.source.id);
    expect(previous.text).toContain(firstParagraph);
    const finding = w.findings.find((f: { id: string }) => f.id === flagged.id);
    expect(finding.sourceChanges[0].quoteFound).toBe(false);
    expect(finding.review).toBe("accepted");
    const readiness = await request(app()).get(
      `/api/roles/${role().id}/readiness`,
    );
    expect(readiness.body.issues).toContain(
      "Re-review facts whose source page changed since the quotation was captured.",
    );
    // Re-reviewing after the change clears the flag; the old quotation still
    // matches the immutable earlier capture, so the record stays valid.
    const rereview = await request(app())
      .patch(`/api/findings/${flagged.id}`)
      .send({ ...finding, review: "clarification" });
    expect(rereview.status).toBe(200);
    expect(
      (await request(app()).get(`/api/roles/${role().id}/readiness`)).body
        .issues,
    ).not.toContain(
      "Re-review facts whose source page changed since the quotation was captured.",
    );
    expect(
      (await request(app()).post(`/api/sources/${webSource.id}/refresh`))
        .status,
    ).toBe(409);
    expect(
      (
        await request(app()).post(
          `/api/sources/${fixture.sources[0].id}/refresh`,
        )
      ).status,
    ).toBe(422);
  });
  it("reports an unchanged page without flagging findings", async () => {
    const w = (await request(app()).get("/api/workspace")).body;
    const latest = w.sources.find((s: Source) => s.supersedes === webSource.id);
    page.current = html(
      latest.text
        .split("\n")
        .map((p: string) => `<p>${p}</p>`)
        .join(""),
    );
    const r = await request(app()).post(`/api/sources/${latest.id}/refresh`);
    expect(r.status).toBe(201);
    expect(r.body.changed).toBe(false);
    expect(r.body.affectedFindingIds).toEqual([]);
  });
});

describe("Refresh integrity", () => {
  const recheck =
    "Re-review facts whose source page changed since the quotation was captured.";
  const latest = async () => {
    const w = (await request(app()).get("/api/workspace")).body;
    return w.sources.find((s: Source) => s.kind === "web" && !s.supersededBy);
  };
  it("stores the diff on the new capture and rejects stale saves made before the refresh", async () => {
    const before = (await request(app()).get("/api/workspace")).body;
    const flagged = before.findings.find(
      (f: { citations: { sourceId: string }[] }) =>
        f.citations[0]?.sourceId === webSource.id,
    );
    // Second finding cites the original capture with a passage still present.
    const created = await request(app())
      .post(`/api/organisations/${fixture.organisations[0].id}/findings`)
      .send({
        roleId: role().id,
        kind: "company",
        claim: "Shifts run in two blocks.",
        citations: [
          {
            sourceId: webSource.id,
            quote: secondParagraph,
            locator: "Paragraph 2",
          },
        ],
        rationale: "",
      });
    expect(created.status).toBe(201);
    const survivor = created.body;
    const gen2 = await latest();
    const gen2Previous = before.sources.find(
      (s: Source) => s.supersededBy === gen2.id,
    );
    expect(gen2.captureDiff.previousId).toBe(gen2Previous.id);
    expect(gen2.captureDiff.changed).toBe(false);
    // Third capture drops the shift sentence: the survivor is newly affected,
    // the already-missing first paragraph is not flagged a second time.
    page.current = html(
      `<p>Our warehouse coordinators now check every inbound delivery against the purchase order and the ASN.</p><p>New: apprenticeships open in March.</p>`,
    );
    const r = await request(app()).post(`/api/sources/${gen2.id}/refresh`);
    expect(r.status).toBe(201);
    expect(r.body.affectedFindingIds).toEqual([survivor.id]);
    expect(r.body.removed).toEqual([secondParagraph]);
    const after = (await request(app()).get("/api/workspace")).body;
    const gen3 = after.sources.find((s: Source) => s.id === r.body.source.id);
    expect(gen3.captureDiff).toEqual({
      previousId: gen2.id,
      changed: true,
      added: [],
      removed: [secondParagraph],
      affectedFindingIds: [survivor.id],
    });
    const stillFlagged = after.findings.find(
      (f: { id: string }) => f.id === flagged.id,
    );
    expect(stillFlagged.sourceChanges).toHaveLength(1);
    // A review panel opened before the refresh holds the old version.
    const stale = await request(app())
      .patch(`/api/findings/${survivor.id}`)
      .send({ ...survivor, review: "accepted" });
    expect(stale.status).toBe(409);
    expect(
      (await request(app()).get(`/api/roles/${role().id}/readiness`)).body
        .issues,
    ).toContain(recheck);
    const fresh = after.findings.find(
      (f: { id: string }) => f.id === survivor.id,
    );
    expect(
      (
        await request(app())
          .patch(`/api/findings/${survivor.id}`)
          .send({ ...fresh, review: "accepted" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .patch(`/api/findings/${flagged.id}`)
          .send({ ...stillFlagged, review: "accepted" })
      ).status,
    ).toBe(200);
  });
  it("keeps a ready profile ready through an unchanged refresh but not through a source edit", async () => {
    const send = async (state: string) =>
      request(app())
        .post(`/api/roles/${role().id}/review-state`)
        .send({ state, version: (await currentRole()).version });
    expect((await send("in-review")).status).toBe(200);
    const ready = await send("ready");
    expect(ready.status).toBe(200);
    expect((await currentRole()).reviewState).toBe("ready");
    const gen3 = await latest();
    page.current = html(
      gen3.text
        .split("\n")
        .map((p: string) => `<p>${p}</p>`)
        .join(""),
    );
    const r = await request(app()).post(`/api/sources/${gen3.id}/refresh`);
    expect(r.status).toBe(201);
    expect(r.body.changed).toBe(false);
    expect((await currentRole()).reviewState).toBe("ready");
    // Superseding bumped the earlier capture's version; a stale edit is 409.
    expect(
      (
        await request(app())
          .patch(`/api/sources/${gen3.id}`)
          .send({ ...gen3, caption: "stale" })
      ).status,
    ).toBe(409);
    const edited = await request(app())
      .patch(`/api/sources/${gen3.id}`)
      .send({
        version: gen3.version + 1,
        roleIds: gen3.roleIds,
        permission: gen3.permission,
        caption: "Checked with the client",
      });
    expect(edited.status).toBe(200);
    const view = await currentRole();
    expect(view.reviewState).toBe("draft");
    expect(view.reviewChanged).toBe(true);
  });
});

describe("Refresh transitions", () => {
  it("flags a finding whose second quotation disappears after its first was already missing", async () => {
    const w = (await request(app()).get("/api/workspace")).body;
    const gen2 = w.sources.find((s: Source) => s.supersedes === webSource.id);
    const latest = w.sources.find(
      (s: Source) => s.kind === "web" && !s.supersededBy,
    );
    const apprenticeships = "New: apprenticeships open in March.";
    expect(latest.text).not.toContain(firstParagraph);
    expect(latest.text).toContain(apprenticeships);
    const created = await request(app())
      .post(`/api/organisations/${fixture.organisations[0].id}/findings`)
      .send({
        roleId: role().id,
        kind: "company",
        claim: "Deliveries are checked and apprenticeships open in March.",
        citations: [
          { sourceId: webSource.id, quote: firstParagraph, locator: "P1" },
          { sourceId: gen2.id, quote: apprenticeships, locator: "P3" },
        ],
        rationale: "",
      });
    expect(created.status).toBe(201);
    page.current = html(
      "<p>Our warehouse coordinators now check every inbound delivery against the purchase order and the ASN.</p>",
    );
    const r = await request(app()).post(`/api/sources/${latest.id}/refresh`);
    expect(r.status).toBe(201);
    expect(r.body.affectedFindingIds).toEqual([created.body.id]);
    expect(r.body.removed).toEqual([apprenticeships]);
    expect(
      (await request(app()).get(`/api/roles/${role().id}/readiness`)).body
        .issues,
    ).toContain(
      "Re-review facts whose source page changed since the quotation was captured.",
    );
  });
  it("reverts ready when source provenance changes or a research run records an error", async () => {
    const w = (await request(app()).get("/api/workspace")).body;
    const flagged = w.findings.find((f: { claim: string }) =>
      f.claim.startsWith("Deliveries are checked"),
    );
    expect(
      (
        await request(app())
          .patch(`/api/findings/${flagged.id}`)
          .send({ ...flagged, review: "rejected" })
      ).status,
    ).toBe(200);
    const send = async (state: string) =>
      request(app())
        .post(`/api/roles/${role().id}/review-state`)
        .send({ state, version: (await currentRole()).version });
    expect((await send("in-review")).status).toBe(200);
    expect((await send("ready")).status).toBe(200);
    // Same text as an existing statement but different provenance: the pack
    // would contain a new source entry, so the profile returns to draft.
    const statement = fixture.sources[0];
    const twin = await request(app())
      .post(`/api/organisations/${fixture.organisations[0].id}/sources`)
      .send({
        title: statement.title,
        text: statement.text,
        kind: statement.kind,
        url: statement.url,
        roleIds: [role().id],
        permission: statement.permission,
        suppliedBy: "A different contact",
        verification: statement.verification,
        publishedAt: "2026-01-01",
        locator: statement.locator,
      });
    expect(twin.status).toBe(201);
    expect((await currentRole()).reviewState).toBe("draft");
    // A finished research run with no errors does not disturb readiness...
    await store.transact((ws) => {
      ws.jobs.push({
        ...base(),
        orgId: fixture.organisations[0].id,
        roleId: role().id,
        tier: "economy",
        status: "completed",
        stage: "done",
        errors: [],
        requestedBy: reviewer.userId,
        attempts: 1,
        runs: [],
      });
    });
    expect((await send("in-review")).status).toBe(200);
    expect((await send("ready")).status).toBe(200);
    expect((await currentRole()).reviewState).toBe("ready");
    // ...but an error recorded on it becomes a pack limitation, so it does.
    await store.transact((ws) => {
      ws.jobs
        .find((j) => j.roleId === role().id)!
        .errors.push("Model call failed: simulated");
    });
    expect((await currentRole()).reviewState).toBe("draft");
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
