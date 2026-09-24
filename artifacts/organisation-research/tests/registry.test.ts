import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import {
  buildHeartbeat,
  heartbeatFields,
  heartbeatUrl,
  registryTiers,
  reportDeploy,
  routesOf,
  sendHeartbeat,
  type Heartbeat,
} from "../server/registry.js";

let store: Store;
let app: Express;
beforeAll(async () => {
  store = await Store.open();
  await store.init();
  app = createApp(store);
});
afterAll(async () => {
  await store.close();
});

const okFetch = (reply: unknown = { ok: true }) =>
  vi.fn(async () => new Response(JSON.stringify(reply), { status: 202 }));

describe("app registry heartbeat", () => {
  it("lists every API route from the running app", () => {
    const routes = routesOf(app);
    expect(routes).toContain("GET /api/health");
    expect(routes).toContain("POST /api/roles/:id/packs");
    expect(routes.length).toBeGreaterThan(40);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("builds only the allow-listed fields, with the right shapes", () => {
    const heartbeat = buildHeartbeat(app, "Yellow");
    expect(Object.keys(heartbeat).sort()).toEqual([...heartbeatFields].sort());
    expect(registryTiers).toContain(heartbeat.tier);
    for (const key of [
      "apiRoutes",
      "dependencies",
      "integrations",
      "dataFlows",
      "keyDecisions",
      "techStack",
    ] as const)
      expect(Array.isArray(heartbeat[key])).toBe(true);
    for (const key of ["description", "purpose", "dataModel", "governanceNotes"] as const) {
      expect(typeof heartbeat[key]).toBe("string");
      expect(heartbeat[key].length).toBeGreaterThan(40);
    }
    expect(heartbeat.dependencies).toContain("express@5.2.1");
    expect(heartbeat.dependencies.every((entry) => /^[@a-z0-9./-]+@[^@]+$/.test(entry))).toBe(true);
  });

  it("refuses to guess a tier that has not been registered", () => {
    expect(() => buildHeartbeat(app, undefined)).toThrow(/tier/i);
  });

  it("never carries a secret or environment value", () => {
    const serialised = JSON.stringify(buildHeartbeat(app, "Yellow"));
    for (const [key, value] of Object.entries(process.env)) {
      if (!value || value.length < 8) continue;
      if (!/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/i.test(key)) continue;
      expect(serialised, `heartbeat leaks ${key}`).not.toContain(value);
    }
    expect(serialised).not.toMatch(/sk_(live|test)_/);
  });

  it("posts JSON with the registry key header and returns the reply", async () => {
    const fetchMock = okFetch({ ok: true, id: "hb_1" });
    const heartbeat = buildHeartbeat(app, "Yellow");
    const reply = await sendHeartbeat(heartbeat, { key: "test-key", fetch: fetchMock as unknown as typeof fetch });
    expect(reply).toEqual({ ok: true, id: "hb_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe(heartbeatUrl);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Registry-Key"]).toBe("test-key");
    expect(JSON.parse(init.body as string) as Heartbeat).toEqual(heartbeat);
  });

  it("rejects with the registry's reason when the profile is refused", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid heartbeat", details: ["tier must be one of Green|Yellow|Orange|Red"] }), { status: 400 }),
    );
    await expect(
      sendHeartbeat(buildHeartbeat(app, "Yellow"), { key: "test-key", fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow(/400.*tier must be one of/);
  });

  it("requires a key rather than sending anonymously", async () => {
    const fetchMock = okFetch();
    await expect(
      sendHeartbeat(buildHeartbeat(app, "Yellow"), { key: "", fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow(/REGISTRY_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("start-up reporting never throws: missing key, network failure and rejection are logged", async () => {
    const log = { log: vi.fn(), warn: vi.fn() };
    expect(await reportDeploy(app, { key: "", log })).toBe(false);
    expect(log.warn.mock.calls[0][0]).toMatch(/REGISTRY_API_KEY/);
    // Tier still unconfirmed in code: the hook reports that, not a stack trace.
    expect(await reportDeploy(app, { key: "test-key", fetch: okFetch() as unknown as typeof fetch, log })).toBe(false);
    expect(log.warn.mock.calls.at(-1)?.[0]).toMatch(/heartbeat failed: .*tier/i);
    const failing = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    expect(await reportDeploy(app, { key: "test-key", tier: "Yellow", fetch: failing as unknown as typeof fetch, log })).toBe(false);
    expect(log.warn.mock.calls.at(-1)?.[0]).toMatch(/heartbeat failed: getaddrinfo ENOTFOUND/);
    expect(await reportDeploy(app, { key: "test-key", tier: "Yellow", fetch: okFetch() as unknown as typeof fetch, log })).toBe(true);
    expect(log.log.mock.calls.at(-1)?.[0]).toMatch(/heartbeat sent \(Yellow, \d+ routes\)/);
  });
});
