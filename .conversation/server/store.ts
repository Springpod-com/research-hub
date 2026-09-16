import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { emptyWorkspace, type Workspace, type Pack } from "../shared/types.js";
export interface SQL {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
}
export class Store {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private db: SQL,
    private pool?: Pool,
  ) {}
  static async open(options: { url?: string; path?: string } = {}) {
    if (options.url) {
      const pool = new Pool({ connectionString: options.url, max: 5 });
      return new Store(pool, pool);
    }
    if (options.path) await mkdir(options.path, { recursive: true });
    return new Store(new PGlite(options.path));
  }
  async init() {
    for (const statement of [
      "CREATE TABLE IF NOT EXISTS research_workspace (id text PRIMARY KEY, data jsonb NOT NULL)",
      "CREATE TABLE IF NOT EXISTS research_packs (id text PRIMARY KEY, org_id text NOT NULL, role_id text NOT NULL, revision integer NOT NULL, snapshot jsonb NOT NULL, UNIQUE(role_id,revision))",
      "CREATE OR REPLACE FUNCTION prevent_research_pack_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Research snapshots are immutable'; END $$",
      "DROP TRIGGER IF EXISTS research_pack_immutable ON research_packs",
      "CREATE TRIGGER research_pack_immutable BEFORE UPDATE OR DELETE ON research_packs FOR EACH ROW EXECUTE FUNCTION prevent_research_pack_mutation()",
    ])
      await this.db.query(statement);
    await this.db.query(
      "INSERT INTO research_workspace(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING",
      ["main", JSON.stringify(emptyWorkspace())],
    );
  }
  async read(): Promise<Workspace> {
    return (
      await this.db.query("SELECT data FROM research_workspace WHERE id=$1", [
        "main",
      ])
    ).rows[0].data;
  }
  async packs(): Promise<Pack[]> {
    return (
      await this.db.query(
        "SELECT snapshot FROM research_packs ORDER BY revision DESC",
      )
    ).rows.map((r) => r.snapshot);
  }
  async transact<T>(fn: (w: Workspace, db: SQL) => Promise<T> | T): Promise<T> {
    const work = async () => {
      const client = this.pool ? await this.pool.connect() : this.db;
      try {
        await client.query("BEGIN");
        const w = (
          await client.query(
            "SELECT data FROM research_workspace WHERE id=$1 FOR UPDATE",
            ["main"],
          )
        ).rows[0].data as Workspace;
        const result = await fn(w, client);
        await client.query(
          "UPDATE research_workspace SET data=$1 WHERE id=$2",
          [JSON.stringify(w), "main"],
        );
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        if ("release" in client) (client as any).release();
      }
    };
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => {});
    return next;
  }
  async close() {
    if (this.pool) await this.pool.end();
    else await (this.db as unknown as PGlite).close();
  }
}
