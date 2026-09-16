import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { Store, type SQL } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import type { Workspace } from "../shared/types.js";

// Counts the statements that rewrite the workspace document.
function counting(db: SQL) {
  const counts = { writes: 0 };
  const wrapped: SQL = {
    async query(sql, values) {
      if (sql.startsWith("UPDATE research_workspace")) counts.writes++;
      return db.query(sql, values);
    },
  };
  return { wrapped, counts };
}

describe("workspace document writes and revisions", () => {
  let inner: Store;
  let store: Store;
  let counts: { writes: number };
  let fixture: Workspace;
  beforeAll(async () => {
    inner = await Store.open();
    const c = counting(inner["db" as keyof Store] as unknown as SQL);
    counts = c.counts;
    store = new Store(c.wrapped);
    await store.init();
    fixture = sampleWorkspace();
    await store.transact((w) => Object.assign(w, fixture));
  });
  afterAll(async () => {
    await inner.close();
  });
  it("does not rewrite the document when a transaction changes nothing", async () => {
    const before = counts.writes;
    const tag = store.etag;
    await store.transact((w) => w.jobs.find((j) => j.status === "queued"));
    expect(counts.writes).toBe(before);
    // ...but the revision still moves on, since other tables may have.
    expect(store.etag).not.toBe(tag);
    await store.transact((w) => {
      w.organisations[0].name += " Ltd";
    });
    expect(counts.writes).toBe(before + 1);
  });
  it("keeps the revision when a transaction fails", async () => {
    const tag = store.etag;
    await expect(
      store.transact(() => {
        throw new Error("no");
      }),
    ).rejects.toThrow("no");
    expect(store.etag).toBe(tag);
  });
  it("answers an unchanged workspace with 304 and a changed one in full", async () => {
    const app = createApp(store, { testMember: reviewer });
    const first = await request(app).get("/api/workspace");
    expect(first.status).toBe(200);
    const tag = first.headers.etag;
    expect(tag).toMatch(/^W\//);
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    const same = await request(app)
      .get("/api/workspace")
      .set("If-None-Match", tag);
    expect(same.status).toBe(304);
    await store.transact((w) => {
      w.organisations[0].summary = "Changed";
    });
    const changed = await request(app)
      .get("/api/workspace")
      .set("If-None-Match", tag);
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(tag);
    expect(changed.body.organisations[0].summary).toBe("Changed");
  });
  it("never treats one person's copy as current for another", async () => {
    // The browser cache is shared by everyone who signs in on that browser,
    // so an administrator's tag must not be answered with 304 for a member.
    const asAdmin = createApp(store, {
      testMember: { ...reviewer, userId: "user_a", role: "admin" },
    });
    const asMember = createApp(store, {
      testMember: { ...reviewer, userId: "user_b", role: "researcher" },
    });
    const admin = await request(asAdmin).get("/api/workspace");
    expect(admin.status).toBe(200);
    const member = await request(asMember)
      .get("/api/workspace")
      .set("If-None-Match", admin.headers.etag);
    expect(member.status).toBe(200);
    expect(member.headers.etag).not.toBe(admin.headers.etag);
    const again = await request(asMember)
      .get("/api/workspace")
      .set("If-None-Match", member.headers.etag);
    expect(again.status).toBe(304);
  });
});

describe("uploaded files live beside the workspace document", () => {
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
  it("stores an upload outside the document and serves it back", async () => {
    const app = createApp(store, { testMember: reviewer });
    const previous = process.env.UPLOAD_SCAN_COMMAND;
    process.env.UPLOAD_SCAN_COMMAND = "true";
    let uploaded;
    try {
      uploaded = await request(app)
        .post(`/api/organisations/${fixture.organisations[0].id}/upload`)
        .attach("file", Buffer.from("Shift handover notes."), "notes.txt");
    } finally {
      process.env.UPLOAD_SCAN_COMMAND = previous;
    }
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.blob).toBeUndefined();
    const stored = (await store.read()).sources.find(
      (s) => s.id === uploaded.body.id,
    )!;
    expect(stored.blob).toBeUndefined();
    expect(stored.filename).toBe("notes.txt");
    const file = await request(app).get(`/api/sources/${stored.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("text/plain");
    expect(file.text).toBe("Shift handover notes.");
    const none = await request(app).get(
      `/api/sources/${fixture.sources[0].id}/file`,
    );
    expect(none.status).toBe(404);
  });
  it("moves files stored inside older documents out on start-up", async () => {
    const legacy = await Store.open();
    await legacy.init();
    const bytes = Buffer.from("%PDF-1.4 legacy upload");
    await legacy.transact((w) => {
      Object.assign(w, sampleWorkspace());
      Object.assign(w.sources[0], {
        blob: bytes.toString("base64"),
        filename: "legacy.pdf",
        mime: "application/pdf",
      });
    });
    const id = (await legacy.read()).sources[0].id;
    // Re-opening the store on the same database is what start-up does.
    const reopened = new Store(legacy["db" as keyof Store] as unknown as SQL);
    await reopened.init();
    const w = await reopened.read();
    expect(w.sources[0].blob).toBeUndefined();
    expect(w.sources[0].filename).toBe("legacy.pdf");
    expect((await reopened.file(id))?.equals(bytes)).toBe(true);
    // A second start finds nothing to move and leaves the document alone.
    await reopened.init();
    expect((await reopened.read()).sources[0].blob).toBeUndefined();
    await legacy.close();
  });
});
