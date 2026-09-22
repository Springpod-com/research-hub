import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import JSZip from "jszip";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { Store, type SQL } from "../server/store.js";
import { reviewer, sampleWorkspace } from "./fixtures.js";

const png = (label: string) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from(label),
  ]);
const jpeg = (label: string) =>
  Buffer.concat([Buffer.from([255, 216, 255]), Buffer.from(label)]);

describe("ZIP image uploads", () => {
  let store: Store;
  let orgId: string;
  let roleId: string;
  let temporary: string;
  let previousScanner: string | undefined;
  let previousNodeEnv: string | undefined;

  beforeEach(async () => {
    store = await Store.open();
    await store.init();
    const fixture = sampleWorkspace();
    orgId = fixture.organisations[0].id;
    roleId = fixture.roles[0].id;
    await store.transact((workspace) => Object.assign(workspace, fixture));
    temporary = mkdtempSync(path.join(os.tmpdir(), "zip-upload-"));
    const scanner = path.join(temporary, "scan.sh");
    writeFileSync(scanner, "#!/bin/sh\ncat >/dev/null\nexit 0\n", {
      mode: 0o755,
    });
    previousScanner = process.env.UPLOAD_SCAN_COMMAND;
    previousNodeEnv = process.env.NODE_ENV;
    process.env.UPLOAD_SCAN_COMMAND = scanner;
  });

  afterEach(async () => {
    if (previousScanner === undefined) delete process.env.UPLOAD_SCAN_COMMAND;
    else process.env.UPLOAD_SCAN_COMMAND = previousScanner;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    rmSync(temporary, { recursive: true, force: true });
    await store.close();
  });

  const app = () => createApp(store, { testMember: reviewer });
  const upload = (archive: Buffer) =>
    request(app())
      .post(`/api/organisations/${orgId}/upload`)
      .field("roleId", roleId)
      .field("folder", "04-media")
      .field("caption", "Workshop reference")
      .attach("file", archive, "images.zip");

  it("imports mixed image archives and reports skipped entries", async () => {
    const zip = new JSZip();
    zip.file("front.png", png("front"));
    zip.file("nested/side.jpg", jpeg("side"));
    zip.file("rear.jpeg", jpeg("rear"));
    zip.file("copy.png", png("front"));
    zip.file("notes.txt", "not an image");
    zip.file("__MACOSX/._front.png", "ignored");
    zip.file(".DS_Store", "ignored");
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
    );

    expect(response.status).toBe(201);
    expect(response.body.imported).toBe(3);
    expect(response.body.skipped).toEqual([
      { name: "notes.txt", reason: "not-image" },
      { name: "copy.png", reason: "duplicate" },
    ]);
    expect(response.body.sources).toHaveLength(3);
    for (const source of response.body.sources) {
      expect(source.folder).toBe("04-media");
      expect(source.roleIds).toEqual([roleId]);
      expect(source.caption).toBe("Workshop reference");
      const file = await request(app()).get(`/api/sources/${source.id}/file`);
      expect(file.status).toBe(200);
      expect(Buffer.isBuffer(file.body)).toBe(true);
    }
    const db = store["db" as keyof Store] as unknown as SQL;
    const scans = await db.query(
      "SELECT scan_clean FROM research_files WHERE source_id = ANY($1)",
      [response.body.sources.map((source: { id: string }) => source.id)],
    );
    expect(scans.rows).toHaveLength(3);
    expect(scans.rows.every((row) => row.scan_clean)).toBe(true);
  });

  it("rejects an image over the per-entry expanded-size limit", async () => {
    const zip = new JSZip();
    const large = Buffer.alloc(15 * 1024 * 1024);
    png("x").copy(large);
    zip.file("large.png", large);
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("10 MB");
  });

  it("rejects more than 200 eligible images during preflight", async () => {
    const zip = new JSZip();
    for (let index = 0; index < 201; index++)
      zip.file(`${index}.png`, png(String(index)));
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("at most 200 images");
  });

  it("skips a large non-image entry without inflating it", async () => {
    const zip = new JSZip();
    zip.file("image.png", png("clean"));
    zip.file("large.txt", Buffer.alloc(15 * 1024 * 1024));
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
    expect(response.status).toBe(201);
    expect(response.body.imported).toBe(1);
    expect(response.body.skipped).toEqual([
      { name: "large.txt", reason: "not-image" },
    ]);
  });

  it("rejects an archive with no images", async () => {
    const zip = new JSZip();
    zip.file("notes.txt", "hello");
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("The ZIP contains no PNG or JPEG images.");
  });

  it("stores nothing when the second image fails scanning", async () => {
    const scanner = path.join(temporary, "threat.sh");
    writeFileSync(
      scanner,
      "#!/bin/sh\nif grep -q THREAT-MARKER; then exit 1; fi\nexit 0\n",
      { mode: 0o755 },
    );
    process.env.UPLOAD_SCAN_COMMAND = scanner;
    const before = (await store.read()).sources.length;
    const zip = new JSZip();
    zip.file("clean.png", png("clean"));
    zip.file("threat.png", png("THREAT-MARKER"));
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("threat.png");
    expect((await store.read()).sources).toHaveLength(before);
    const db = store["db" as keyof Store] as unknown as SQL;
    expect(
      (await db.query("SELECT source_id FROM research_files")).rows,
    ).toHaveLength(0);
  });

  it("stores nothing when the scanner is unavailable", async () => {
    process.env.UPLOAD_SCAN_COMMAND = path.join(temporary, "missing");
    const before = (await store.read()).sources.length;
    const zip = new JSZip();
    zip.file("image.png", png("clean"));
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    expect(response.status).toBe(503);
    expect((await store.read()).sources).toHaveLength(before);
  });

  it("records no clean verdict when development scanning is unconfigured", async () => {
    delete process.env.UPLOAD_SCAN_COMMAND;
    process.env.NODE_ENV = "development";
    const zip = new JSZip();
    zip.file("image.png", png("clean"));
    const response = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    expect(response.status).toBe(201);
    const sourceId = response.body.sources[0].id;
    const db = store["db" as keyof Store] as unknown as SQL;
    const row = (
      await db.query(
        "SELECT scan_clean FROM research_files WHERE source_id=$1",
        [sourceId],
      )
    ).rows[0];
    expect(row.scan_clean).toBe(false);
    expect(await store.cleanFile(sourceId)).toBeUndefined();
  });

  it("fails closed when production scanning is unconfigured", async () => {
    const application = app();
    delete process.env.UPLOAD_SCAN_COMMAND;
    process.env.NODE_ENV = "production";
    const before = (await store.read()).sources.length;
    const zip = new JSZip();
    zip.file("image.png", png("clean"));
    const response = await request(application)
      .post(`/api/organisations/${orgId}/upload`)
      .attach(
        "file",
        await zip.generateAsync({ type: "nodebuffer" }),
        "images.zip",
      );
    expect(response.status).toBe(503);
    expect((await store.read()).sources).toHaveLength(before);
    const db = store["db" as keyof Store] as unknown as SQL;
    expect(
      (await db.query("SELECT source_id FROM research_files")).rows,
    ).toHaveLength(0);
  });

  it("keeps the 10 MiB limit for non-ZIP uploads", async () => {
    const response = await request(app())
      .post(`/api/organisations/${orgId}/upload`)
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1, 65), "large.txt");
    expect(response.status).toBe(413);
    expect(response.body.error).toBe("File too large");
  });
});
