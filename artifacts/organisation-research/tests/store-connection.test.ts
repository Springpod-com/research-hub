import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { Store } from "../server/store.js";
import { emptyWorkspace } from "../shared/types.js";

// A pool whose only client loses its connection while a transaction holds it.
// pg emits "error" on the client; with no listener Node would end the process.
function fakePool() {
  const released: unknown[] = [];
  const client = Object.assign(new EventEmitter(), {
    dead: false,
    async query(sql: string) {
      if (this.dead)
        throw new Error(
          "Client has encountered a connection error and is not queryable",
        );
      if (sql.startsWith("SELECT"))
        return { rows: [{ data: emptyWorkspace() }] };
      return { rows: [] };
    },
    release(err?: unknown) {
      released.push(err);
    },
  });
  return {
    client,
    released,
    async connect() {
      return client;
    },
    async query(sql: string, values?: unknown[]) {
      return client.query(sql);
    },
  };
}

describe("store survives a lost database connection", () => {
  it("fails the transaction and hands the broken client back to the pool", async () => {
    const pool = fakePool();
    const store = new Store(pool as never, pool as never);
    const dropped = new Error("Connection terminated unexpectedly");
    const result = store.transact(async () => {
      // Simulates the server closing the socket while the workspace is held.
      expect(() => pool.client.emit("error", dropped)).not.toThrow();
      pool.client.dead = true;
    });
    await expect(result).rejects.toBe(dropped);
    expect(pool.released).toEqual([dropped]);
    expect(pool.client.listenerCount("error")).toBe(0);
    // The next transaction is independent of the failed one.
    pool.client.dead = false;
    await expect(store.transact(() => "ok")).resolves.toBe("ok");
    expect(pool.released).toEqual([dropped, undefined]);
  });
});
