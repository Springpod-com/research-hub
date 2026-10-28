import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import JSZip from "jszip";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import type { Workspace } from "../shared/types.js";
import { knowledgeBaseSchema } from "./studio-contract.js";

// Plan P0.2 (28 Oct 2026): every pack this app exports must import into
// Studio, whose parser refuses a pack with a missing required field or a null
// where it expects text.

let store: Store;
let fixture: Workspace;
beforeAll(async () => {
  store = await Store.open();
  await store.init();
  fixture = sampleWorkspace();
  const org = fixture.organisations[0];
  org.mayUse = [];
  org.mustNotSay = [];
  for (const finding of fixture.findings) finding.review = "accepted";
  await store.transact((w) => Object.assign(w, fixture));
});
afterAll(async () => {
  await store.close();
});
const app = () => createApp(store, { testMember: reviewer });

const binary = (res: NodeJS.ReadableStream, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};

describe("Studio import contract", () => {
  it("exports packs Studio's parser accepts, as JSON and inside the ZIP", async () => {
    const pack = await request(app())
      .post(`/api/roles/${fixture.roles[0].id}/packs`)
      .send({});
    expect(pack.status).toBe(201);

    const json = await request(app()).get(`/api/packs/${pack.body.id}/json`);
    expect(json.status).toBe(200);
    const parsed = knowledgeBaseSchema.safeParse(JSON.parse(json.text));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(parsed.data?.findings.length).toBeGreaterThan(0);
    expect(parsed.data?.register.length).toBe(parsed.data?.findings.length);

    const zip = await request(app())
      .get(`/api/packs/${pack.body.id}/zip`)
      .buffer(true)
      .parse(binary);
    expect(zip.status).toBe(200);
    const archive = await JSZip.loadAsync(zip.body as Buffer);
    const entry = Object.values(archive.files).find(
      (file) => file.name.split("/").pop()?.toLowerCase() === "knowledge-base.json",
    );
    expect(entry).toBeDefined();
    const inZip = knowledgeBaseSchema.safeParse(JSON.parse(await entry!.async("string")));
    expect(inZip.success ? [] : inZip.error.issues).toEqual([]);
  });

  it("is a real check: Studio refuses a null where it expects text", async () => {
    const pack = await request(app())
      .post(`/api/roles/${fixture.roles[0].id}/packs`)
      .send({});
    const json = JSON.parse((await request(app()).get(`/api/packs/${pack.body.id}/json`)).text);
    json.organisation.summary = null;
    expect(knowledgeBaseSchema.safeParse(json).success).toBe(false);
  });
});
