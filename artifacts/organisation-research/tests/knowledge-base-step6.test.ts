import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import JSZip from "jszip";
import mammoth from "mammoth";
import { load } from "cheerio";
import { createApp } from "../server/app.js";
import {
  base,
  makePack,
  packMarkdown,
  roleFingerprint,
  sectionsView,
} from "../server/domain.js";
import { packDocx, packFolderZip } from "../server/export.js";
import { Store } from "../server/store.js";
import {
  sectionNoteMaxLength,
  type Member,
  type PackV2,
} from "../shared/types.js";
import { sampleWorkspace } from "./fixtures.js";

const stores: Store[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

const researcher: Member = {
  userId: "user_researcher",
  name: "Rae Search",
  role: "researcher",
  active: true,
};

function notedWorkspace() {
  const workspace = sampleWorkspace();
  const role = workspace.roles[0];
  const source = workspace.sources[0];
  source.folder = "02-role";
  source.tier = 2;
  workspace.findings[0].slot = "role.title";
  workspace.findings[0].review = "accepted";
  role.sectionNotes = {
    role: {
      text: "Keep the shift handover visually prominent.\n\nUse the team's own language.",
      by: "Rae Search",
      at: "2025-05-06T12:30:00.000Z",
    },
  };
  return workspace;
}

function notedPack(): PackV2 {
  const workspace = notedWorkspace();
  const role = workspace.roles[0];
  return makePack(
    workspace,
    role.orgId,
    role.id,
    "Rae Search",
    "draft",
    1,
  ) as PackV2;
}

async function documentXml(document: Buffer) {
  const archive = await JSZip.loadAsync(document);
  return archive.file("word/document.xml")!.async("string");
}

describe("knowledge-base Step 6 designer notes and source trails", () => {
  it("returns the note from the correct section scope and null when unset", () => {
    const workspace = notedWorkspace();
    const role = workspace.roles[0];
    workspace.organisations[0].sectionNotes = {
      organisation: {
        text: "Organisation-wide direction",
        by: "Rae Search",
        at: "2025-05-01T00:00:00.000Z",
      },
    };
    const response = sectionsView(workspace, role.orgId, role.id);
    expect(
      response.sections.find((section) => section.section === "organisation")
        ?.note?.text,
    ).toBe("Organisation-wide direction");
    expect(
      response.sections.find((section) => section.section === "role")?.note
        ?.text,
    ).toContain("shift handover");
    expect(
      response.sections.find((section) => section.section === "case")?.note,
    ).toBeNull();
  });

  it("validates, authorises, clears and audits note updates", async () => {
    const store = await Store.open();
    stores.push(store);
    await store.init();
    const workspace = sampleWorkspace();
    workspace.members.push(researcher);
    const foreignRole = {
      ...workspace.roles[0],
      ...base(),
      orgId: workspace.organisations[1].id,
    };
    workspace.roles.push(foreignRole);
    await store.transact((current) => Object.assign(current, workspace));
    const role = workspace.roles[0];
    const route = `/api/orgs/${role.orgId}/sections/role/note`;

    const missingRole = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ text: "Direction" });
    expect(missingRole.status).toBe(422);

    const wrongOrganisation = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ text: "Direction", roleId: foreignRole.id });
    expect(wrongOrganisation.status).toBe(404);

    const tooLong = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ text: "x".repeat(sectionNoteMaxLength + 1), roleId: role.id });
    expect(tooLong.status).toBe(422);

    const inactive = await request(
      createApp(store, {
        testMember: { ...researcher, userId: "inactive", active: false },
      }),
    )
      .put(route)
      .send({ text: "Direction", roleId: role.id });
    expect(inactive.status).toBe(403);

    const saved = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ text: "  Direction for the designer  ", roleId: role.id });
    expect(saved.status).toBe(200);
    expect(saved.body.note).toMatchObject({
      text: "Direction for the designer",
      by: researcher.name,
    });

    const sections = await request(
      createApp(store, { testMember: researcher }),
    ).get(`/api/orgs/${role.orgId}/sections?roleId=${role.id}`);
    expect(
      sections.body.sections.find(
        (section: { section: string }) => section.section === "role",
      ).note.text,
    ).toBe("Direction for the designer");

    const cleared = await request(
      createApp(store, { testMember: researcher }),
    )
      .put(route)
      .send({ text: " \n ", roleId: role.id });
    expect(cleared.status).toBe(200);
    expect(cleared.body.note).toBeNull();
    const stored = await store.read();
    expect(
      stored.audit.filter((entry) => entry.action === "section.note"),
    ).toHaveLength(2);
    expect(stored.audit[0]).toMatchObject({
      actor: researcher.userId,
      action: "section.note",
      subjectId: role.id,
    });
    expect(stored.roles[0].version).toBe(workspace.roles[0].version + 2);
  });

  it("snapshots notes and renders notes and per-section source trails", () => {
    const pack = notedPack();
    const roleSection = pack.sections.find(
      (section) => section.section === "role",
    )!;
    expect(roleSection.note?.text).toContain("shift handover");
    const markdown = packMarkdown(pack);
    expect(markdown).toContain("### Designer's note");
    expect(markdown).toContain("### Sources read");
    expect(markdown).toContain(
      "| Sample role brief — fictional | 2 | The role as the organisation names it |",
    );
    expect(markdown.match(/### Sources read/g)).toHaveLength(6);
    expect(markdown.indexOf("### Sources read")).toBeLessThan(
      markdown.indexOf("### In one paragraph"),
    );
    expect(markdown).toContain("## Sources register");
    expect(markdown).toContain("## For the organisation to confirm");
    expect(markdown).toContain(
      "| Source | Folder | Tier | Facts | Confirmed by | Date |",
    );
    const headings = markdown
      .split("\n")
      .filter((line) => line.startsWith("#"));
    const roleHeading = headings.indexOf("## 2. The role");
    expect(headings.slice(roleHeading, roleHeading + 4)).toEqual([
      "## 2. The role",
      "### Designer's note",
      "### Sources read",
      "### The role as the organisation names it",
    ]);
  });

  it("puts both blocks in DOCX and the note file in the folder archive", async () => {
    const pack = notedPack();
    const document = await packDocx(pack);
    const text = (await mammoth.extractRawText({ buffer: document })).value;
    expect(text).toContain("Designer's note");
    expect(text).toContain("Sources read");
    expect(text).toContain("What it gave us");
    const xml = await documentXml(document);
    const $ = load(xml, { xmlMode: true });
    const paragraphTexts = $("w\\:body w\\:p")
      .map((_, paragraph) => $(paragraph).find("w\\:t").text())
      .get();
    const roleHeading = paragraphTexts.indexOf("2. The role");
    const noteHeading = paragraphTexts.indexOf("Designer's note", roleHeading);
    const sourcesHeading = paragraphTexts.indexOf("Sources read", noteHeading);
    const firstFact = paragraphTexts.indexOf(
      "The coordinator checks incoming deliveries against purchase orders.",
      sourcesHeading,
    );
    expect(roleHeading).toBeGreaterThanOrEqual(0);
    expect(noteHeading).toBeGreaterThan(roleHeading);
    expect(sourcesHeading).toBeGreaterThan(noteHeading);
    expect(firstFact).toBeGreaterThan(sourcesHeading);

    const store = await Store.open();
    stores.push(store);
    await store.init();
    const archive = await JSZip.loadAsync(await packFolderZip(pack, store));
    const note = archive.file("02-role/00-designers-note.md");
    expect(note).toBeTruthy();
    await expect(note!.async("text")).resolves.toContain(
      "Keep the shift handover visually prominent.",
    );
  });

  it("escapes hostile designer-note text in well-formed DOCX XML", async () => {
    const pack = notedPack();
    const hostile = `Use <angle> & "double quotes", 'single quotes' and a fake </w:p> tag.`;
    pack.sections.find((section) => section.section === "role")!.note!.text =
      hostile;
    const xml = await documentXml(await packDocx(pack));
    const $ = load(xml, { xmlMode: true });

    expect($("w\\:document")).toHaveLength(1);
    expect($("w\\:t").text()).toContain(hostile);
    expect(xml).toContain("&lt;angle&gt;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;double quotes&quot;");
    expect(xml).toContain("&apos;single quotes&apos;");
    expect(xml).toContain("&lt;/w:p&gt;");
  });

  it("renders source trails but no designer-note block when notes and sources are absent", async () => {
    const workspace = sampleWorkspace();
    workspace.sources = [];
    workspace.findings = [];
    const role = workspace.roles[0];
    const pack = makePack(
      workspace,
      role.orgId,
      role.id,
      "Rae Search",
      "draft",
      1,
    ) as PackV2;

    const markdown = packMarkdown(pack);
    expect(markdown).not.toContain("### Designer's note");
    expect(markdown.match(/### Sources read/g)).toHaveLength(6);
    expect(
      markdown.match(/_No sources filed in this folder\._/g),
    ).toHaveLength(6);

    const xml = await documentXml(await packDocx(pack));
    const $ = load(xml, { xmlMode: true });
    const sourceHeadings = $("w\\:p").filter(
      (_, node) => $(node).find("w\\:t").text().trim() === "Sources read",
    );
    expect(sourceHeadings).toHaveLength(6);
    sourceHeadings.each((_, node) => {
      const table = $(node).next("w\\:tbl");
      expect(table).toHaveLength(1);
      expect(table.children("w\\:tr")).toHaveLength(1);
      expect(table.text()).toContain("What it gave us");
    });
    expect($("w\\:t").text()).not.toContain("Designer's note");
  });

  it("keeps every stored pack export immutable when a note is written later", async () => {
    const workspace = sampleWorkspace();
    const role = workspace.roles[0];
    const pack = makePack(
      workspace,
      role.orgId,
      role.id,
      "Rae Search",
      "draft",
      1,
    ) as PackV2;
    const store = await Store.open();
    stores.push(store);
    await store.init();
    const snapshot = async (value: PackV2) => {
      const docxXml = await documentXml(await packDocx(value));
      const zip = await JSZip.loadAsync(await packFolderZip(value, store));
      return {
        json: JSON.stringify(value),
        markdown: packMarkdown(value),
        docxXml,
        zipPaths: Object.keys(zip.files).sort(),
        zipJson: await zip.file("knowledge-base.json")!.async("string"),
        zipMarkdown: await zip.file("knowledge-base.md")!.async("string"),
        zipDocxXml: await documentXml(
          await zip
            .file("Springpod_LEARN_Organisation_Knowledge_Base_V1.docx")!
            .async("nodebuffer"),
        ),
      };
    };
    const before = await snapshot(pack);

    role.sectionNotes = {
      role: {
        text: "New direction written after the snapshot.",
        by: "Rae Search",
        at: "2025-07-01T00:00:00.000Z",
      },
    };
    const after = await snapshot(pack);
    expect(after).toEqual(before);
    expect(after.markdown).not.toContain("New direction written");
    expect(after.zipPaths).not.toContain("02-role/00-designers-note.md");

    const fresh = makePack(
      workspace,
      role.orgId,
      role.id,
      "Rae Search",
      "draft",
      2,
    ) as PackV2;
    expect(
      fresh.sections.find((section) => section.section === "role")?.note?.text,
    ).toBe("New direction written after the snapshot.");
    expect(packMarkdown(fresh)).toContain("New direction written");
  });

  it("reserves the plain designer-note ZIP path before case-insensitive source collisions", async () => {
    const pack = notedPack();
    pack.sources[0].exportName = "00-DESIGNERS-NOTE.md";
    const store = await Store.open();
    stores.push(store);
    await store.init();
    const archive = await JSZip.loadAsync(await packFolderZip(pack, store));

    const designerNote = archive.file("02-role/00-designers-note.md");
    const collidingSource = archive.file(
      "02-role/00-DESIGNERS-NOTE-2.md",
    );
    expect(designerNote).toBeTruthy();
    expect(collidingSource).toBeTruthy();
    await expect(designerNote!.async("text")).resolves.toContain(
      "Keep the shift handover visually prominent.",
    );
    await expect(collidingSource!.async("text")).resolves.toContain(
      "Sample role brief — fictional",
    );
  });

  it("drifts readiness only when note text changes", () => {
    const workspace = notedWorkspace();
    const role = workspace.roles[0];
    const original = roleFingerprint(workspace, role);
    role.sectionNotes!.role = {
      ...role.sectionNotes!.role!,
      by: "Another researcher",
      at: "2025-06-01T00:00:00.000Z",
    };
    expect(roleFingerprint(workspace, role)).toBe(original);
    role.sectionNotes!.role!.text = "Changed direction";
    expect(roleFingerprint(workspace, role)).not.toBe(original);
  });
});