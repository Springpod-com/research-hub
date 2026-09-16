import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import { publicAddress, extractPage } from "../server/retrieval.js";
import type { Workspace } from "../shared/types.js";
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
