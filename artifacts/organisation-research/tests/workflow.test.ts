import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import { publicAddress } from "../server/retrieval.js";
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
  it("blocks a ready pack until findings and activities are reviewed", async () => {
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
