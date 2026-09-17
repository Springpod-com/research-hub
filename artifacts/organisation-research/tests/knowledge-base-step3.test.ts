import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import mammoth from "mammoth";
import { makePack } from "../server/domain.js";
import {
  confirmationMarkdown,
  packDocx,
  packFolderZip,
  packFolderZipStream,
} from "../server/export.js";
import { Store } from "../server/store.js";
import { sampleWorkspace } from "./fixtures.js";

const stores: Store[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

function packFixture() {
  const workspace = sampleWorkspace();
  const finding = workspace.findings[0];
  finding.slot = "role.vocabulary";
  finding.parts = ["day"];
  finding.fields = { term: "Purchase\u0001 order", meaning: "The order record" };
  finding.claim = "Purchase\u0001 order — The order record";
  finding.review = "accepted";
  const role = workspace.roles[0];
  role.standard = {
    name: "Warehouse Operative Standard",
    level: "2",
    duration: "12 months",
    url: "https://example.com/standard",
    assessmentPlanUrl: "https://example.com/assessment",
  };
  return makePack(
    workspace,
    role.orgId,
    role.id,
    "Alex Morgan",
    "draft",
    3,
  );
}

describe("knowledge-base Step 3 exports", () => {
  it("fills the supplied layout, reference blocks and rows safely", async () => {
    const document = await packDocx(packFixture());
    const zip = await JSZip.loadAsync(document);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).not.toContain("\u0001");
    const text = (await mammoth.extractRawText({ buffer: document })).value;
    expect(text).toContain(
      "Northstar Logistics · organisation knowledge base",
    );
    expect(text).toContain("7. Fact register");
    expect(text).toContain("For the organisation to confirm");
    expect(text).toContain("Organisation, as it writes its own name");
    expect(text).toContain("The duties, from the standard");
    expect(text).toContain("Vocabulary");
    expect(text).toContain("Purchase order");
    expect(text).toContain("Warehouse Operative Standard");
    expect(text).toContain(
      "[Which company the learner meets: the group, the division",
    );
  });

  it("builds six folders, notes, the DOCX and an export-named source", async () => {
    const store = await Store.open();
    stores.push(store);
    await store.init();
    const pack = packFixture();
    const archive = await JSZip.loadAsync(await packFolderZip(pack, store));
    for (const folder of [
      "01-organisation",
      "02-role",
      "03-case-material",
      "04-media",
      "05-brand",
      "06-organisation-supplied",
    ])
      expect(archive.file(`${folder}/About this folder.txt`)).toBeTruthy();
    expect(
      archive.file("Springpod_LEARN_Organisation_Knowledge_Base_V1.docx"),
    ).toBeTruthy();
    const source = pack.sources[0];
    expect(archive.file(`${source.folder}/${source.exportName}`)).toBeTruthy();
  });

  it("renders the standalone confirmation table", () => {
    const pack = packFixture();
    if (pack.schemaVersion !== "2.0.0") throw new Error("Expected PackV2");
    const markdown = confirmationMarkdown(pack);
    expect(markdown).toContain("# For the organisation to confirm");
    expect(markdown).toContain("Confirmed (initials, date)");
  });

  it("reserves collision names across an a.txt, a.txt, a-2.txt chain", async () => {
    const store = await Store.open();
    stores.push(store);
    await store.init();
    const pack = packFixture();
    const original = pack.sources[0];
    pack.sources = ["a.txt", "a.txt", "a-2.txt"].map((exportName, index) => ({
      ...original,
      id: `${index + 1}`.repeat(8),
      title: `Collision ${index}`,
      exportName,
      folder: "01-organisation",
    }));
    const archive = await JSZip.loadAsync(await packFolderZip(pack, store));
    expect(archive.file("01-organisation/a.txt")).toBeTruthy();
    expect(archive.file("01-organisation/a-2.txt")).toBeTruthy();
    expect(archive.file("01-organisation/a-3.txt")).toBeTruthy();
  });

  it("streams the archive and records sources omitted above the limit", async () => {
    const store = await Store.open();
    stores.push(store);
    await store.init();
    const pack = packFixture();
    const original = pack.sources[0];
    pack.sources = Array.from({ length: 401 }, (_, index) => ({
      ...original,
      id: `source-${index}`,
      title: `Source ${index}`,
      exportName: `source-${index}.txt`,
      folder: "01-organisation",
    }));
    const stream = await packFolderZipStream(pack, store);
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
    const archive = await JSZip.loadAsync(bytes);
    const note = await archive.file("Sources omitted.txt")!.async("string");
    expect(note).toContain("source count exceeds 400");
    expect(archive.file("01-organisation/source-399.txt")).toBeTruthy();
    expect(archive.file("01-organisation/source-400.txt")).toBeNull();
  });
});