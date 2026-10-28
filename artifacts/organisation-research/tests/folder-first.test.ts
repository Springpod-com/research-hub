import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { sectionsView } from "../server/domain.js";
import { Store } from "../server/store.js";
import {
  migrateSectionStatus,
  migrateSimplifiedApproval,
} from "../server/store.js";
import { shouldCrawl } from "../server/research.js";
import type { Member, Workspace } from "../shared/types.js";
import { reviewer, sampleWorkspace } from "./fixtures.js";

let store: Store;
let fixture: Workspace;
const researcher: Member = {
  userId: "user_researcher",
  name: "Rae Search",
  role: "researcher",
  active: true,
};

beforeAll(async () => {
  store = await Store.open();
  await store.init();
  fixture = sampleWorkspace();
  fixture.members.push(researcher);
  await store.transact((workspace) => Object.assign(workspace, fixture));
});

afterAll(async () => {
  await store.close();
});

describe("folder-first research", () => {
  it("applies explicit and legacy website crawl choices", () => {
    expect(shouldCrawl({ crawl: true, sourceIds: [] })).toBe(true);
    expect(shouldCrawl({ crawl: false })).toBe(false);
    expect(shouldCrawl({})).toBe(true);
    expect(shouldCrawl({ sourceIds: [] })).toBe(false);
  });

  it("migrates legacy fact and folder approval values once", () => {
    const legacy = sampleWorkspace();
    legacy.findings[0].review = "clarification";
    legacy.roles[0].sectionStatus = {
      role: { stage: "complete", by: "old", at: "2024-01-01" },
    };
    expect(migrateSimplifiedApproval(legacy, "2025-03-02T00:00:00.000Z")).toBe(
      true,
    );
    expect(legacy.findings[0].review).toBe("accepted");
    expect(legacy.roles[0].sectionStatus.role?.stage).toBe("gathering");
    expect(
      legacy.audit.filter((entry) =>
        entry.action.startsWith("Simplified approval migration:"),
      ),
    ).toHaveLength(1);
    expect(migrateSimplifiedApproval(legacy)).toBe(false);
  });

  it("reports status, unreviewed facts and sources added after extraction", () => {
    const role = fixture.roles[0];
    const source = fixture.sources[0];
    source.folder = "02-role";
    fixture.findings[0].slot = "role.title";
    role.sectionStatus = {
      role: {
        stage: "extracted",
        by: "research run earlier",
        at: new Date(Date.parse(source.createdAt) - 1000).toISOString(),
      },
    };
    const section = sectionsView(
      fixture,
      role.orgId,
      role.id,
    ).sections.find((item) => item.section === "role")!;
    expect(section.status.stage).toBe("extracted");
    expect(section.addedSinceExtraction).toBe(1);
    expect(section.unreviewed).toBe(1);
  });

  it("counts a moved source after extraction when the folder is reviewed", () => {
    const workspace = sampleWorkspace();
    const role = workspace.roles[0];
    const source = workspace.sources[0];
    source.folder = "02-role";
    source.createdAt = "2025-01-01T00:00:00.000Z";
    source.updatedAt = "2025-01-03T00:00:00.000Z";
    role.sectionStatus = {
      role: {
        stage: "reviewed",
        by: reviewer.userId,
        at: "2025-01-02T00:00:00.000Z",
      },
    };
    const section = sectionsView(
      workspace,
      role.orgId,
      role.id,
    ).sections.find((item) => item.section === "role")!;
    expect(section.addedSinceExtraction).toBe(1);
  });

  it("migrates legacy placed facts once without changing new gathering defaults", () => {
    const legacy = sampleWorkspace();
    legacy.findings[0].slot = "role.title";
    const at = "2025-02-01T00:00:00.000Z";
    expect(migrateSectionStatus(legacy, at)).toBe(true);
    expect(legacy.roles[0].sectionStatus?.role).toEqual({
      stage: "extracted",
      by: "migration",
      at,
    });
    expect(legacy.organisations[0].sectionStatus?.organisation).toBeUndefined();
    expect(migrateSectionStatus(legacy, "2025-03-01T00:00:00.000Z")).toBe(
      false,
    );
    expect(legacy.roles[0].sectionStatus?.role?.at).toBe(at);
  });

  it("allows reviewer sign-off without preconditions and rejects complete", async () => {
    const role = fixture.roles[0];
    const route = `/api/orgs/${role.orgId}/sections/role/status`;
    const denied = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ stage: "reviewed", roleId: role.id });
    expect(denied.status).toBe(403);

    const reviewed = await request(createApp(store, { testMember: reviewer }))
      .put(route)
      .send({ stage: "reviewed", roleId: role.id });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status.stage).toBe("reviewed");

    const deniedUndo = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ stage: "gathering", roleId: role.id });
    expect(deniedUndo.status).toBe(403);

    const undone = await request(createApp(store, { testMember: reviewer }))
      .put(route)
      .send({ stage: "gathering", roleId: role.id });
    expect(undone.status).toBe(200);
    expect(undone.body.status.stage).toBe("gathering");

    const complete = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ stage: "complete", roleId: role.id });
    expect(complete.status).toBe(422);
  });

  it("creates Markdown notes with folder and tier defaults", async () => {
    const organisation = fixture.organisations[0];
    const response = await request(createApp(store, { testMember: researcher }))
      .post(`/api/organisations/${organisation.id}/sources`)
      .send({
        title: "Website reading note",
        text: "# What we found\n\nThe service covers the whole country.",
        kind: "note",
        extractedFrom: "https://example.org/about",
        suppliedBy: researcher.name,
      });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      folder: "01-organisation",
      tier: 2,
      tierReason:
        "Team note; extracted from https://example.org/about",
    });
    expect(response.body.exportName).toMatch(/\.md$/);
  });

  it("rejects research for a role folder without a role or a readable source", async () => {
    const organisation = fixture.organisations[0];
    const withoutRole = await request(
      createApp(store, { testMember: researcher }),
    )
      .post(`/api/organisations/${organisation.id}/research`)
      .send({ sections: ["role"] });
    expect(withoutRole.status).toBe(422);
    expect(withoutRole.body.error).toContain("requires a role");

    const gathering = await request(
      createApp(store, { testMember: researcher }),
    )
      .post(`/api/organisations/${organisation.id}/research`)
      .send({ sections: ["brand"] });
    expect(gathering.status).toBe(422);
    expect(gathering.body.error).toContain("at least one readable source");
  });
});