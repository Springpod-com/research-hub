import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { makePack, packMarkdown } from "../server/domain.js";
import { packZip, packZipName } from "../server/export.js";
import { sampleWorkspace } from "./fixtures.js";

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

describe("Pack downloads (plan P1.7, 28 Oct 2026)", () => {
  it("zips exactly the JSON Studio imports and the Markdown for people", async () => {
    const pack = packFixture();
    const zip = await JSZip.loadAsync(await packZip(pack));
    expect(Object.keys(zip.files).sort()).toEqual(["knowledge-base.json", "knowledge-base.md"]);
    expect(await zip.file("knowledge-base.json")!.async("string")).toBe(JSON.stringify(pack, null, 2));
    expect(await zip.file("knowledge-base.md")!.async("string")).toBe(packMarkdown(pack));
    expect(packZipName(pack)).toMatch(/_knowledge-base_r3\.zip$/);
  });
});
describe("pack header people", () => {
  it("prints the compiler's display name and omits an empty fact-checker job title", () => {
    const workspace = sampleWorkspace();
    const role = workspace.roles[0]!;
    const organisation = workspace.organisations.find((item) => item.id === role.orgId)!;
    organisation.factChecker = { name: "Priya Shah", jobTitle: "" };
    const pack = makePack(workspace, role.orgId, role.id, "user_2abc", "draft", 1, "Alex Morgan");
    if (pack.schemaVersion !== "2.0.0") throw new Error("expected a 2.0.0 pack");
    expect(pack.header.compiledBy).toBe("Alex Morgan");
    expect(pack.createdBy).toBe("user_2abc");
    expect(pack.header.factChecker).toBe("Priya Shah");
    const legacy = makePack(workspace, role.orgId, role.id, "user_2abc", "draft", 2);
    if (legacy.schemaVersion !== "2.0.0") throw new Error("expected a 2.0.0 pack");
    expect(legacy.header.compiledBy).toBe("user_2abc");
  });
});
