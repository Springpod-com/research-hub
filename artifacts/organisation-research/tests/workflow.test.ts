import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import { publicAddress, extractPage } from "../server/retrieval.js";
import type { Workspace } from "../shared/types.js";
import type { PackV1 } from "../shared/types.js";
import {
  base,
  findingView,
  makePack,
  packMarkdown,
  roleFingerprint,
  reviewStateOf,
  sectionsView,
  sourceView,
} from "../server/domain.js";
let store: Store;
let fixture: Workspace;
beforeAll(async () => {
  store = await Store.open();
  await store.init();
  fixture = sampleWorkspace();
  await store.transact((w) => Object.assign(w, fixture));
});
afterAll(async () => {
  await store.close();
});
const app = () => createApp(store, { testMember: reviewer });
describe("Evidence and immutable pack workflow", () => {
  it("fails closed when Clerk is unconfigured", async () => {
    const r = await request(createApp(store)).get("/api/workspace");
    expect([401, 503]).toContain(r.status);
  });
  it("rejects browser mutations from an untrusted origin", async () => {
    const r = await request(app())
      .post("/api/organisations")
      .set("Origin", "https://untrusted.example")
      .send({});
    expect(r.status).toBe(403);
  });
  it("requires an exact source quotation and the same organisation", async () => {
    const f = fixture.findings[0];
    const route = `/api/organisations/${f.orgId}/findings`;
    expect(
      (
        await request(app())
          .post(route)
          .send({
            ...f,
            citations: [{ ...f.citations[0], quote: "Made up passage" }],
          })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app())
          .post(`/api/organisations/${fixture.organisations[1].id}/findings`)
          .send({ ...f, roleId: undefined })
      ).status,
    ).toBe(422);
  });
  it("accepts a verbatim passage copied with different spacing or quotation marks", async () => {
    const f = fixture.findings[0];
    const source = fixture.sources.find(
      (s) => s.id === f.citations[0].sourceId,
    )!;
    const words = source.text.slice(0, 80).trim();
    const restyled = words.replace(/ /g, "\n  ").replace(/'/g, "’");
    const r = await request(app())
      .post(`/api/organisations/${f.orgId}/findings`)
      .send({
        claim: "Restyled quotation",
        kind: "company",
        citations: [{ sourceId: source.id, quote: restyled, locator: "p1" }],
      });
    expect(r.status).toBe(201);
    // Exclude it again so the shared workspace stays reviewable below.
    expect(
      (
        await request(app())
          .patch(`/api/findings/${r.body.id}`)
          .send({ ...r.body, review: "rejected" })
      ).status,
    ).toBe(200);
    const wrongWords = await request(app())
      .post(`/api/organisations/${f.orgId}/findings`)
      .send({
        claim: "Paraphrased quotation",
        kind: "company",
        citations: [
          {
            sourceId: source.id,
            quote: words.replace(/e/, "3"),
            locator: "p1",
          },
        ],
      });
    expect(wrongWords.status).toBe(422);
    expect(wrongWords.body.error).toContain("was not found in");
  });
  it("validates replacement citations and invented measurement citations", async () => {
    const current = (await request(app()).get("/api/workspace")).body;
    const finding = current.findings.find(
      (item: { id: string }) => item.id === fixture.findings[0].id,
    );
    const foreign = {
      ...fixture.sources[0],
      ...base(),
      orgId: fixture.organisations[1].id,
      roleIds: [],
    };
    await store.transact((w) => {
      w.sources.push(foreign);
    });
    const foreignCitation = await request(app())
      .patch(`/api/findings/${finding.id}`)
      .send({
        ...finding,
        citations: [
          {
            sourceId: foreign.id,
            quote: foreign.text,
            locator: foreign.locator,
          },
        ],
      });
    expect(foreignCitation.status).toBe(422);

    const created = await request(app())
      .post(`/api/organisations/${fixture.organisations[0].id}/findings`)
      .send({
        claim: "42 units",
        kind: "proposal",
        citations: [],
        rationale: "Invented and declared.",
        slot: "case.measurement",
        fields: { reading: "42", origin: "invented and declared" },
      });
    const cited = await request(app())
      .patch(`/api/findings/${created.body.id}`)
      .send({
        ...created.body,
        citations: fixture.findings[0].citations,
      });
    expect(cited.status).toBe(422);
    expect(cited.body.error).toContain("must not have citations");
    expect(
      (
        await request(app())
          .patch(`/api/findings/${created.body.id}`)
          .send({ ...created.body, review: "rejected" })
      ).status,
    ).toBe(200);
  });
  it("explains why a source without captured text cannot support a fact", async () => {
    const f = fixture.findings[0];
    const template = fixture.sources.find(
      (s) => s.id === f.citations[0].sourceId,
    )!;
    const photo = {
      ...template,
      id: randomUUID(),
      kind: "image" as const,
      title: "Warehouse photo",
      text: "",
      rights: "reference-only" as const,
    };
    await store.transact((w) => {
      w.sources.push(photo);
    });
    const r = await request(app())
      .post(`/api/organisations/${f.orgId}/findings`)
      .send({
        claim: "Observation from a photo",
        kind: "company",
        citations: [
          { sourceId: photo.id, quote: "anything", locator: "Photo" },
        ],
      });
    expect(r.status).toBe(422);
    expect(r.body.error).toContain("no captured text");
    const noPassage = await request(app())
      .post(`/api/organisations/${f.orgId}/findings`)
      .send({
        claim: "Fact without a passage",
        kind: "company",
        citations: [
          { sourceId: f.citations[0].sourceId, quote: "", locator: "" },
        ],
      });
    expect(noPassage.status).toBe(422);
    expect(noPassage.body.error).toContain(
      "Paste the exact supporting passage",
    );
  });
  it("blocks a ready pack until findings are reviewed", async () => {
    expect(
      (
        await request(app())
          .post(`/api/roles/${fixture.roles[0].id}/packs`)
          .send({ status: "ready" })
      ).status,
    ).toBe(422);
  });
  it("records review history and rejects stale edits", async () => {
    const f = fixture.findings[0];
    const r = await request(app())
      .patch(`/api/findings/${f.id}`)
      .send({ ...f, review: "accepted" });
    expect(r.status).toBe(200);
    expect(r.body.history[0].review).toBe("unreviewed");
    expect(
      (
        await request(app())
          .patch(`/api/findings/${f.id}`)
          .send({ ...f, review: "accepted" })
      ).status,
    ).toBe(409);
    const a = fixture.activities[0];
    expect(
      (
        await request(app())
          .patch(`/api/activities/${a.id}`)
          .send({ ...a, review: "accepted" })
      ).status,
    ).toBe(200);
  });
  it("bulk-reviews facts atomically through the individual review path", async () => {
    const orgId = fixture.organisations[0].id;
    const create = (claim: string) =>
      request(app())
        .post(`/api/organisations/${orgId}/findings`)
        .send({ claim, kind: "proposal", citations: [], rationale: "Initial" });
    const first = await create("Bulk review proposal one");
    const second = await create("Bulk review proposal two");
    const ids = [first.body.id, second.body.id];
    const reviewed = await request(app())
      .post("/api/findings/bulk-review")
      .send({ ids, review: "accepted", rationale: "Reviewed together" });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.findings).toHaveLength(2);
    expect(reviewed.body.findings[0]).toMatchObject({
      review: "accepted",
      rationale: "Reviewed together",
      tier: 4,
      slot: "none",
      parts: [],
    });
    expect(reviewed.body.findings[0].history).toHaveLength(1);
    const version = reviewed.body.findings[0].version;
    const failed = await request(app())
      .post("/api/findings/bulk-review")
      .send({
        ids: [ids[0], randomUUID()],
        review: "clarification",
      });
    expect(failed.status).toBe(404);
    const unchanged = (await request(app()).get("/api/workspace")).body.findings
      .find((finding: { id: string }) => finding.id === ids[0]);
    expect(unchanged.version).toBe(version);
    expect(unchanged.review).toBe("accepted");
    expect(
      (
        await request(app())
          .post("/api/findings/bulk-review")
          .send({ ids, review: "rejected" })
      ).status,
    ).toBe(200);
  });
  it("creates a new source kind with knowledge-base metadata", async () => {
    const created = await request(app())
      .post(`/api/organisations/${fixture.organisations[0].id}/sources`)
      .send({
        title: "Approved induction film",
        text: "The induction film explains the shift handover.",
        kind: "film",
        roleIds: [fixture.roles[0].id],
        suppliedBy: reviewer.name,
        folder: "03-case-material",
        rights: "organisation-supplied",
        providedBy: { name: "Jamie Smith", jobTitle: "Operations manager" },
        transcriptSourceId: fixture.sources[0].id,
        timecode: "00:02:10",
        tier: 1,
        tierReason: "Supplied directly by the organisation.",
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      kind: "film",
      folder: "03-case-material",
      rights: "organisation-supplied",
      tier: 1,
      tierReason: "Supplied directly by the organisation.",
      providedBy: { name: "Jamie Smith", jobTitle: "Operations manager" },
    });
    const cleared = await request(app())
      .patch(`/api/sources/${created.body.id}`)
      .send({
        version: created.body.version,
        permission: created.body.permission,
        caption: created.body.caption || "",
        roleIds: created.body.roleIds,
        folder: null,
        rights: null,
        providedBy: null,
        transcriptSourceId: null,
        timecode: null,
      });
    expect(cleared.status).toBe(200);
    expect(cleared.body.folder).toBe("04-media");
    expect(cleared.body.rights).toBeUndefined();
    expect(cleared.body.providedBy).toBeUndefined();
    expect(cleared.body.transcriptSourceId).toBeUndefined();
    expect(cleared.body.timecode).toBeUndefined();
  });
  it("rejects demoting a source cited by an organisation list", async () => {
    const citedSource = {
      ...fixture.sources[0],
      ...base(),
      tier: 1 as const,
      tierReason: "Confirmed directly by the organisation.",
    };
    await store.transact((w) => {
      w.sources.push(citedSource);
      w.organisations[0].mayUse = [
        { text: "Northstar", sourceId: citedSource.id },
      ];
    });
    const demoted = await request(app())
      .patch(`/api/sources/${citedSource.id}`)
      .send({
        version: citedSource.version,
        permission: citedSource.permission,
        caption: "",
        roleIds: citedSource.roleIds,
        tier: 2,
        tierReason: "Public material.",
      });
    expect(demoted.status).toBe(422);
    expect(demoted.body.error).toContain("Names we may use");
    await store.transact((w) => {
      delete w.organisations[0].mayUse;
      w.sources = w.sources.filter((source) => source.id !== citedSource.id);
    });
  });
  it("clears verification when a researcher changes verified fact content", async () => {
    const created = await request(app())
      .post(`/api/organisations/${fixture.organisations[0].id}/findings`)
      .send({
        claim: "A verified proposal",
        kind: "proposal",
        citations: [],
        rationale: "",
      });
    const verified = await request(app())
      .patch(`/api/findings/${created.body.id}`)
      .send({ ...created.body, verified: { note: "Confirmed" } });
    expect(verified.body.verified.by).toBe(reviewer.name);
    const researcher = createApp(store, {
      testMember: { ...reviewer, userId: "user_researcher", role: "researcher" },
    });
    const changed = await request(researcher)
      .patch(`/api/findings/${created.body.id}`)
      .send({
        version: verified.body.version,
        claim: "Changed by a researcher",
        kind: verified.body.kind,
        citations: verified.body.citations,
        review: verified.body.review,
        rationale: verified.body.rationale,
        slot: verified.body.slot,
      });
    expect(changed.status).toBe(200);
    expect(changed.body.verified).toBeUndefined();
    expect(changed.body.tier).toBe(4);
    expect(changed.body.history.at(-1).verified.note).toBe("Confirmed");
    const reverified = await request(app())
      .patch(`/api/findings/${created.body.id}`)
      .send({
        ...changed.body,
        claim: "Changed and re-verified by a reviewer",
        verified: { note: "Reconfirmed" },
      });
    expect(reverified.body.verified.note).toBe("Reconfirmed");
    expect(
      (
        await request(app())
          .patch(`/api/findings/${created.body.id}`)
          .send({ ...reverified.body, review: "rejected", verified: null })
      ).status,
    ).toBe(200);
  });
  it("requires provenance for answers and blocks on unresolved material questions", async () => {
    const q = await request(app())
      .post(`/api/organisations/${fixture.roles[0].orgId}/questions`)
      .send({
        text: "Confirm scope",
        roleId: fixture.roles[0].id,
        blocking: true,
      });
    expect(q.status).toBe(201);
    expect(
      (
        await request(app())
          .post(`/api/roles/${fixture.roles[0].id}/packs`)
          .send({ status: "ready" })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app())
          .patch(`/api/questions/${q.body.id}`)
          .send({ version: 1, status: "answered", answer: "Confirmed" })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app()).patch(`/api/questions/${q.body.id}`).send({
          version: 1,
          status: "answered",
          answer: "Confirmed",
          provenance: "Synthetic client meeting",
        })
      ).status,
    ).toBe(200);
  });
  it("limits ready packs and membership management by workspace role", async () => {
    const researcher = createApp(store, {
      testMember: { ...reviewer, role: "researcher" },
    });
    expect(
      (
        await request(researcher)
          .post(`/api/roles/${fixture.roles[0].id}/packs`)
          .send({ status: "ready" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app()).post("/api/members").send({
          userId: "user_test",
          name: "Test",
          role: "admin",
          active: true,
        })
      ).status,
    ).toBe(403);
  });
  it("exports identical immutable snapshots with increasing revisions", async () => {
    await store.transact((w) => {
      for (const source of w.sources.filter(
        (item) =>
          item.orgId === fixture.organisations[0].id &&
          ["image", "film"].includes(item.kind),
      )) {
        source.rights = "reference-only";
        if (source.kind === "film" && !source.transcriptSourceId)
          source.caption = "No transcript is available for this film.";
      }
    });
    const path = `/api/roles/${fixture.roles[0].id}/packs`;
    const markReady = async () => {
      const role = (await request(app()).get("/api/workspace")).body.roles[0];
      return request(app())
        .post(`/api/roles/${role.id}/review-state`)
        .send({ state: "ready", version: role.version });
    };
    expect((await markReady()).status).toBe(200);
    const first = await request(app()).post(path).send({ status: "ready" });
    expect(first.status).toBe(201);
    expect(first.body.employerApproval).toBe(false);
    const org = fixture.organisations[0];
    expect(
      (
        await request(app())
          .patch(`/api/organisations/${org.id}`)
          .send({ ...org, summary: "Later edited summary" })
      ).status,
    ).toBe(200);
    // The edit returned the profile to draft; it must be re-reviewed first.
    expect(
      (await request(app()).post(path).send({ status: "ready" })).status,
    ).toBe(422);
    expect((await markReady()).status).toBe(200);
    const second = await request(app()).post(path).send({ status: "ready" });
    expect(second.body.revision).toBe(first.body.revision + 1);
    const json = await request(app()).get(`/api/packs/${first.body.id}/json`);
    const md = await request(app()).get(`/api/packs/${first.body.id}/md`);
    const zip = await request(app()).get(`/api/packs/${first.body.id}/zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers["content-type"]).toContain("application/zip");
    expect(json.body.organisation.summary).toBe(org.summary);
    const embedded = md.text.split("```json\n")[1].split("\n```")[0];
    expect(JSON.parse(embedded)).toEqual(json.body);
    await expect(
      store.transact(async (_w, db) => {
        await db.query("DELETE FROM research_packs WHERE id=$1", [
          first.body.id,
        ]);
      }),
    ).rejects.toThrow("immutable");
    expect((await store.packs()).length).toBe(2);
  });
  it("deletes a role with its scoped records but never an exported one", async () => {
    const org = fixture.organisations[0];
    const source = fixture.sources[0];
    const created = await request(app())
      .post(`/api/organisations/${org.id}/roles`)
      .send({
        title: "Temporary role",
        location: "",
        seniority: "",
        responsibilities: "",
        boundaries: "",
      });
    expect(created.status).toBe(201);
    const role = created.body;
    const scoped = await request(app())
      .post(`/api/organisations/${org.id}/findings`)
      .send({
        claim: "Scoped to the temporary role",
        kind: "proposal",
        roleId: role.id,
        citations: [],
      });
    expect(scoped.status).toBe(201);
    const shared = await request(app())
      .post(`/api/organisations/${org.id}/findings`)
      .send({
        claim: "Organisation-wide proposal",
        kind: "proposal",
        citations: [],
      });
    expect(shared.status).toBe(201);
    const jobId = randomUUID();
    await store.transact((w) => {
      const linked = w.sources.find((s) => s.id === source.id)!;
      linked.roleIds.push(role.id);
      linked.runIds.push(jobId);
      linked.captureDiff = {
        previousId: randomUUID(),
        changed: true,
        added: [],
        removed: ["A sentence"],
        affectedFindingIds: [scoped.body.id, shared.body.id],
      };
      w.jobs.push({
        ...role,
        id: jobId,
        orgId: org.id,
        roleId: role.id,
        tier: "power",
        status: "queued",
        stage: "Queued",
        errors: [],
        requestedBy: reviewer.userId,
        attempts: 0,
        runs: [],
      });
    });
    const researcher = createApp(store, {
      testMember: {
        ...reviewer,
        userId: "user_researcher",
        role: "researcher",
      },
    });
    expect(
      (
        await request(researcher)
          .delete(`/api/roles/${role.id}`)
          .send({ version: role.version })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .delete(`/api/roles/${role.id}`)
          .send({ version: role.version + 1 })
      ).status,
    ).toBe(409);
    const busy = await request(app())
      .delete(`/api/roles/${role.id}`)
      .send({ version: role.version });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toContain("in progress");
    await store.transact((w) => {
      w.jobs.find((j) => j.roleId === role.id)!.status = "cancelled";
    });
    const removed = await request(app())
      .delete(`/api/roles/${role.id}`)
      .send({ version: role.version });
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toEqual({
      findings: 1,
      questions: 0,
      activities: 0,
      jobs: 1,
    });
    expect(removed.body.sourcesUnlinked).toBe(1);
    const w = (await request(app()).get("/api/workspace")).body;
    expect(w.roles.some((r: { id: string }) => r.id === role.id)).toBe(false);
    expect(w.findings.map((f: { id: string }) => f.id)).not.toContain(
      scoped.body.id,
    );
    expect(w.findings.map((f: { id: string }) => f.id)).toContain(
      shared.body.id,
    );
    const retained = w.sources.find((s: { id: string }) => s.id === source.id);
    expect(retained.roleIds).not.toContain(role.id);
    expect(retained.runIds).not.toContain(jobId);
    expect(retained.captureDiff.affectedFindingIds).toEqual([shared.body.id]);
    expect(
      w.audit.some(
        (a: { subjectId: string; action: string }) =>
          a.subjectId === role.id && a.action.includes("deleted"),
      ),
    ).toBe(true);
    // The fixture role has immutable packs from the snapshot test above.
    const exported = (await request(app()).get("/api/workspace")).body.roles[0];
    const kept = await request(app())
      .delete(`/api/roles/${exported.id}`)
      .send({ version: exported.version });
    expect(kept.status).toBe(409);
    expect(kept.body.error).toContain("research pack");
  });
  it("protects files and refuses invalid uploads", async () => {
    expect(
      (
        await request(app())
          .post(`/api/organisations/${fixture.organisations[0].id}/upload`)
          .attach("file", Buffer.from("not a pdf"), "bad.pdf")
      ).status,
    ).toBe(422);
  });
  it("applies the upload scanner's verdict and fails closed when it is unavailable", async () => {
    // A stand-in for clamdscan: reads stdin, exit 1 on the marker, else 0.
    const dir = mkdtempSync(path.join(os.tmpdir(), "scan-"));
    const scanner = path.join(dir, "scan.sh");
    writeFileSync(
      scanner,
      "#!/bin/sh\nif grep -q THREAT-MARKER; then exit 1; fi\nexit 0\n",
      { mode: 0o755 },
    );
    const previous = process.env.UPLOAD_SCAN_COMMAND;
    process.env.UPLOAD_SCAN_COMMAND = scanner;
    try {
      const url = `/api/organisations/${fixture.organisations[0].id}/upload`;
      const clean = await request(app())
        .post(url)
        .attach("file", Buffer.from("Shift handover notes."), "notes.txt");
      expect(clean.status).toBe(201);
      const markdown = await request(app())
        .post(url)
        .attach(
          "file",
          Buffer.from("# Handover\n\n- Two shift blocks."),
          "handover.md",
        );
      expect(markdown.status).toBe(201);
      expect(markdown.body.text).toBe("# Handover\n\n- Two shift blocks.");
      expect(markdown.body.mime).toBe("text/markdown");
      const binary = await request(app())
        .post(url)
        .attach("file", Buffer.from([35, 0, 1]), "handover.md");
      expect(binary.status).toBe(422);
      const other = await request(app())
        .post(url)
        .attach("file", Buffer.from("x"), "notes.html");
      expect(other.status).toBe(422);
      const flagged = await request(app())
        .post(url)
        .attach("file", Buffer.from("THREAT-MARKER"), "notes.txt");
      expect(flagged.status).toBe(422);
      process.env.UPLOAD_SCAN_COMMAND = path.join(dir, "missing.sh");
      const unavailable = await request(app())
        .post(url)
        .attach("file", Buffer.from("Shift handover notes."), "notes.txt");
      expect(unavailable.status).toBe(503);
    } finally {
      if (previous === undefined) delete process.env.UPLOAD_SCAN_COMMAND;
      else process.env.UPLOAD_SCAN_COMMAND = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("Knowledge-base derived views and packs", () => {
  it("derives source names, folders and tiers and reports section gaps", () => {
    const w = sampleWorkspace();
    w.findings[0].slot = "role.duty";
    const source = sourceView(w.sources[0]);
    expect(source.folder).toBe("01-organisation");
    expect(source.tier).toBe(2);
    expect(source.exportName).toMatch(
      /^\d{4}-\d{2}-\d{2}_team_sample-role-brief-fictional\.txt$/,
    );
    expect(findingView(w, w.findings[0])).toMatchObject({
      slot: "role.duty",
      parts: [],
      tier: 2,
    });
    const view = sectionsView(w, w.organisations[0].id, w.roles[0].id);
    const role = view.sections.find((section) => section.section === "role")!;
    expect(role.slots.find((slot) => slot.slot === "role.duty")?.filled).toBe(
      true,
    );
    expect(view.missing).not.toContain("The role: Duties");
    expect(view.missing).toContain("The role: Apprenticeship standard");
  });

  it("builds a 2.0.0 register and still renders a stored 1.0.0 pack", () => {
    const w = sampleWorkspace();
    w.findings[0].slot = "role.duty";
    w.findings[0].parts = ["day", "day"];
    const pack = makePack(
      w,
      w.organisations[0].id,
      w.roles[0].id,
      reviewer.userId,
      "draft",
      1,
    );
    expect(pack.schemaVersion).toBe("2.0.0");
    if (pack.schemaVersion !== "2.0.0") throw new Error("Expected PackV2");
    expect(pack.employerApproval).toBe(false);
    expect(pack.register[0]).toMatchObject({
      n: 1,
      slot: "role.duty",
      tier: 2,
      parts: ["day"],
    });
    expect(pack.toConfirm).toHaveLength(1);
    const schema = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "docs/research-pack-v2.schema.json"),
        "utf8",
      ),
    );
    const sectionKeys = schema.properties.sections.items.required.sort();
    expect(Object.keys(pack.sections[0]).sort()).toEqual(sectionKeys);
    expect(pack.sections[0]).not.toHaveProperty("roleScoped");
    const {
      header: _header,
      tiers: _tiers,
      sections: _sections,
      register: _register,
      toConfirm: _toConfirm,
      ...basePack
    } = pack;
    const legacy = { ...basePack, schemaVersion: "1.0.0" } as PackV1;
    expect(packMarkdown(legacy)).toContain("Schema 1.0.0");
  });
  it("fingerprints every new pack and readiness input", () => {
    const mutations: ((w: Workspace) => void)[] = [
      (w) => {
        w.organisations[0].factChecker = {
          name: "Pat Jones",
          jobTitle: "Fact checker",
        };
      },
      (w) => {
        Object.assign(w.findings[0], {
          slot: "role.duty",
          parts: ["day"],
          fields: { duty: "Check deliveries" },
          verified: { by: "Pat Jones", at: new Date().toISOString() },
        });
      },
      (w) => {
        Object.assign(w.sources[0], {
          folder: "03-case-material",
          tier: 1,
          tierReason: "Confirmed",
          rights: "organisation-supplied",
          transcriptSourceId: randomUUID(),
          timecode: "00:01:20",
          providedBy: { name: "Pat Jones", jobTitle: "Manager" },
        });
      },
    ];
    for (const mutate of mutations) {
      const w = sampleWorkspace();
      const role = w.roles[0];
      role.reviewState = "ready";
      role.readyFingerprint = roleFingerprint(w, role);
      mutate(w);
      expect(reviewStateOf(w, role)).toEqual({ state: "draft", changed: true });
    }
  });
});
describe("Web capture", () => {
  it("uses only the document title, ignoring inline SVG titles", () => {
    const html = `<html><head><title>
      About us | Example Ltd
    </title></head><body><header><svg><title>Example Logo</title></svg></header>
    <main><p>We employ 200 people.</p></main></body></html>`;
    const page = extractPage(html, "https://example.com/about");
    expect(page.title).toBe("About us | Example Ltd");
    expect(page.text).toBe("We employ 200 people.");
  });
});
describe("Proxy awareness", () => {
  it("rate-limits each forwarded client separately", async () => {
    const a = app();
    const from = (ip: string) =>
      request(a).get("/api/health").set("X-Forwarded-For", ip);
    const first = await from("203.0.113.5");
    const other = await from("203.0.113.6");
    const second = await from("203.0.113.5");
    expect(first.status).toBe(200);
    const remaining = (r: request.Response) =>
      Number(r.headers["ratelimit-remaining"]);
    expect(remaining(first)).toBe(899);
    expect(remaining(other)).toBe(899);
    expect(remaining(second)).toBe(898);
    // Writes have their own, tighter budget that reads do not consume.
    const write = await request(a)
      .post("/api/organisations")
      .set("X-Forwarded-For", "203.0.113.5")
      .send({});
    expect(remaining(write)).toBe(179);
  });
});
describe("Public source network boundary", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
  ])("rejects %s", (address) => expect(publicAddress(address)).toBe(false));
  it("accepts public addresses", () =>
    expect(publicAddress("8.8.8.8")).toBe(true));
});
