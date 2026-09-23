import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  sections,
  slots,
  type SectionStatus,
  type Workspace,
  type Pack,
} from "../shared/types.js";
const SECTION_STATUS_MIGRATION = "section-status-from-placed-facts-v1";
const SIMPLIFIED_APPROVAL_MIGRATION = "simplified-approval-v1";

/** Normalise approval values retired by the simplified workflow. */
export function migrateSimplifiedApproval(
  workspace: Workspace,
  at = new Date().toISOString(),
): boolean {
  workspace.migrations ||= [];
  if (workspace.migrations.includes(SIMPLIFIED_APPROVAL_MIGRATION)) return false;
  let facts = 0;
  let folders = 0;
  for (const finding of workspace.findings) {
    if (finding.review === "unreviewed" || finding.review === "clarification") {
      finding.review = "accepted";
      finding.updatedAt = at;
      facts++;
    }
  }
  for (const subject of [...workspace.organisations, ...workspace.roles])
    for (const status of Object.values(subject.sectionStatus || {}))
      if (status?.stage === "complete") {
        status.stage = "gathering";
        status.by = "migration";
        status.at = at;
        folders++;
      }
  workspace.audit.push({
    id: randomUUID(),
    at,
    actor: "migration",
    action: `Simplified approval migration: registered ${facts} legacy facts; reset ${folders} legacy folders`,
    subjectId: "workspace",
  });
  workspace.migrations.push(SIMPLIFIED_APPROVAL_MIGRATION);
  return true;
}

/** Backfill only legacy placed facts; new workspaces retain gathering defaults. */
export function migrateSectionStatus(
  workspace: Workspace,
  at = new Date().toISOString(),
): boolean {
  workspace.migrations ||= [];
  if (workspace.migrations.includes(SECTION_STATUS_MIGRATION)) return false;
  const extracted = (): SectionStatus => ({
    stage: "extracted",
    by: "migration",
    at,
  });
  const placed = workspace.findings.filter(
    (finding) => finding.review !== "rejected" && finding.slot && finding.slot !== "none",
  );
  for (const organisation of workspace.organisations) {
    for (const section of sections.filter((item) => !item.roleScoped)) {
      if (organisation.sectionStatus?.[section.section]) continue;
      const sectionSlots = new Set(
        slots
          .filter((slot) => slot.section === section.section)
          .map((slot) => slot.slot),
      );
      if (
        placed.some(
          (finding) =>
            finding.orgId === organisation.id &&
            sectionSlots.has(finding.slot as never),
        )
      ) {
        organisation.sectionStatus ||= {};
        organisation.sectionStatus[section.section] = extracted();
      }
    }
    for (const role of workspace.roles.filter(
      (item) => item.orgId === organisation.id,
    )) {
      for (const section of sections.filter((item) => item.roleScoped)) {
        if (role.sectionStatus?.[section.section]) continue;
        const sectionSlots = new Set(
          slots
            .filter((slot) => slot.section === section.section)
            .map((slot) => slot.slot),
        );
        if (
          placed.some(
            (finding) =>
              finding.orgId === organisation.id &&
              (!finding.roleId || finding.roleId === role.id) &&
              sectionSlots.has(finding.slot as never),
          )
        ) {
          role.sectionStatus ||= {};
          role.sectionStatus[section.section] = extracted();
        }
      }
    }
  }
  workspace.migrations.push(SECTION_STATUS_MIGRATION);
  return true;
}
export interface SQL {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
}
export class Store {
  private tail: Promise<unknown> = Promise.resolve();
  // Every committed transaction advances the revision. With a per-process
  // prefix it forms the workspace ETag: a client whose copy carries the
  // current tag is answered with 304 before the document is even read, and
  // knows it has nothing to re-render. The count lives in memory because the
  // app runs as one process (one Reserved VM, one dev server); a change made
  // to the database by anything else is picked up at the next restart, when
  // the prefix changes and every tag is stale.
  private revision = 0;
  private readonly boot = randomUUID().slice(0, 8);
  constructor(
    private db: SQL,
    private pool?: Pool,
  ) {}
  get etag() {
    return `W/"${this.boot}-${this.revision}"`;
  }
  static async open(options: { url?: string; path?: string } = {}) {
    if (options.url) {
      const pool = new Pool({ connectionString: options.url, max: 5 });
      // The database closes idle connections now and then (maintenance,
      // failover, a compute restart). The pool discards the broken client;
      // without this listener Node treats the event as fatal and the whole
      // server exits.
      pool.on("error", (e) =>
        console.error(`[store] idle database connection lost: ${e.message}`),
      );
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
      // Uploaded files, one row per source. They are kept out of the
      // workspace document so that reading or saving the workspace never
      // carries every upload along (two documents made it 8 MB).
      "CREATE TABLE IF NOT EXISTS research_files (source_id text PRIMARY KEY, data bytea NOT NULL, scan_clean boolean NOT NULL DEFAULT false)",
      "ALTER TABLE research_files ADD COLUMN IF NOT EXISTS scan_clean boolean NOT NULL DEFAULT false",
    ])
      await this.db.query(statement);
    await this.db.query(
      "INSERT INTO research_workspace(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING",
      ["main", JSON.stringify(emptyWorkspace())],
    );
    await this.moveFilesOutOfWorkspace();
    await this.transact((workspace) => {
      migrateSectionStatus(workspace);
      migrateSimplifiedApproval(workspace);
    });
  }
  // Earlier versions stored each upload as base64 inside its source record.
  // Move any that remain into research_files, once, on start-up.
  private async moveFilesOutOfWorkspace() {
    const moved = await this.transact(async (w, db) => {
      let count = 0;
      for (const s of w.sources) {
        if (!s.blob) continue;
        await db.query(
          "INSERT INTO research_files(source_id,data) VALUES($1,$2) ON CONFLICT (source_id) DO NOTHING",
          [s.id, Buffer.from(s.blob, "base64")],
        );
        delete s.blob;
        count++;
      }
      return count;
    });
    if (moved)
      console.log(
        `[store] moved ${moved} uploaded file(s) out of the workspace document`,
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
  /** The bytes of an uploaded file, or undefined when the source has none. */
  async file(sourceId: string): Promise<Buffer | undefined> {
    const row = (
      await this.db.query(
        "SELECT data FROM research_files WHERE source_id=$1",
        [sourceId],
      )
    ).rows[0];
    return row ? Buffer.from(row.data) : undefined;
  }
  /** Uploaded bytes may enter an export only with a recorded clean scan. */
  async cleanFile(sourceId: string): Promise<Buffer | undefined> {
    const row = (
      await this.db.query(
        "SELECT data FROM research_files WHERE source_id=$1 AND scan_clean=true",
        [sourceId],
      )
    ).rows[0];
    return row ? Buffer.from(row.data) : undefined;
  }
  /** Stores an uploaded file; call inside `transact` with its `db`. */
  static putFile(db: SQL, sourceId: string, data: Buffer, scanClean = false) {
    return db.query(
      "INSERT INTO research_files(source_id,data,scan_clean) VALUES($1,$2,$3) ON CONFLICT (source_id) DO UPDATE SET data=EXCLUDED.data,scan_clean=EXCLUDED.scan_clean",
      [sourceId, data, scanClean],
    );
  }
  async transact<T>(fn: (w: Workspace, db: SQL) => Promise<T> | T): Promise<T> {
    const work = async () => {
      const client = this.pool ? await this.pool.connect() : this.db;
      // A checked-out client has no error listener of its own, so a
      // connection the database closes mid-transaction would take the server
      // down. Record it: the transaction fails through its next query and
      // the client is returned to the pool as broken rather than reused.
      const pooled = "release" in client ? (client as PoolClient) : undefined;
      let lost: Error | undefined;
      const onLost = (e: Error) => {
        lost = e;
      };
      pooled?.on("error", onLost);
      try {
        await client.query("BEGIN");
        const w = (
          await client.query(
            "SELECT data FROM research_workspace WHERE id=$1 FOR UPDATE",
            ["main"],
          )
        ).rows[0].data as Workspace;
        const before = JSON.stringify(w);
        const result = await fn(w, client);
        // A transaction that changed nothing (a check that found nothing to
        // do) must not rewrite the whole document.
        const after = JSON.stringify(w);
        if (after !== before)
          await client.query(
            "UPDATE research_workspace SET data=$1 WHERE id=$2",
            [after, "main"],
          );
        await client.query("COMMIT");
        // Other tables (packs, files) may have changed even when the
        // document did not, so every commit advances the revision.
        this.revision++;
        return result;
      } catch (e) {
        if (!lost) await client.query("ROLLBACK").catch(() => {});
        throw lost ?? e;
      } finally {
        pooled?.removeListener("error", onLost);
        pooled?.release(lost);
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
