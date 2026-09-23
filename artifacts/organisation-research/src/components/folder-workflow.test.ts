import { describe, expect, it } from "vitest";
import type { ResearchJob, SectionSummary } from "../../shared/types";
import {
  canEditSectionNote,
  extractionSourceIds,
  noteRoleIds,
  retryResearchBody,
  runWorkspaceAction,
  sectionSelectionReason,
  validFolderSection,
} from "./folder-workflow";

const summary = (overrides: Partial<SectionSummary> = {}): SectionSummary => ({
  section: "organisation",
  folder: "01-organisation",
  title: "The organisation",
  roleScoped: false,
  slots: [],
  filled: 0,
  total: 0,
  sourceIds: [],
  gaps: [],
  status: { stage: "complete", by: "researcher", at: "2026-01-01" },
  addedSinceExtraction: 0,
  unreviewed: 0,
  note: null,
  ...overrides,
});

describe("folder workflow safeguards", () => {
  it("allows any stage with a readable source and explains missing sources", () => {
    expect(sectionSelectionReason(summary({ roleScoped: true }), undefined)).toBe("Choose a role to use this folder");
    expect(sectionSelectionReason(summary(), "role-1")).toBe("Add at least one source first");
    expect(
      sectionSelectionReason(
        summary({
          status: { stage: "gathering", by: "", at: "" },
          sourceIds: ["source-1"],
          readableSourceIds: ["source-1"],
        }),
        "role-1",
      ),
    ).toBeUndefined();
    expect(
      sectionSelectionReason(
        summary({ sourceIds: ["broken"], readableSourceIds: [] }),
        "role-1",
      ),
    ).toBe("Add at least one source first");
  });

  it("requires roles only for role-scoped notes", () => {
    expect(noteRoleIds("01-organisation", "role-1")).toEqual([]);
    expect(() => noteRoleIds("02-role")).toThrow("Choose a role");
    expect(noteRoleIds("02-role", "role-1")).toEqual(["role-1"]);
  });

  it("gates role-scoped note editing when all roles are selected", () => {
    expect(canEditSectionNote(summary({ roleScoped: true }), true)).toBe(false);
    expect(canEditSectionNote(summary({ roleScoped: true }), true, "role-1")).toBe(true);
    expect(canEditSectionNote(summary(), true)).toBe(true);
  });

  it("reloads the workspace and sections after saving", async () => {
    const calls: string[] = [];
    await runWorkspaceAction(
      async () => { calls.push("save"); },
      async () => { calls.push("workspace"); },
      async () => { calls.push("sections"); },
    );
    expect(calls).toEqual(["save", "workspace", "sections"]);
  });

  it("puts folder sources before organisation context and caps at 16", () => {
    const own = Array.from({ length: 15 }, (_, i) => ({ id: `own-${i}`, folder: "02-role" as const }));
    const context = Array.from({ length: 3 }, (_, i) => ({ id: `context-${i}`, folder: "01-organisation" as const }));
    expect(extractionSourceIds([...context, ...own], "02-role")).toEqual([...own.map((source) => source.id), "context-0"]);
  });

  it("retains the complete research request when retrying", () => {
    const job = { tier: "power", roleId: "role-1", sections: ["role"], sourceIds: ["source-1"], crawl: false } as ResearchJob;
    expect(retryResearchBody(job)).toEqual({ tier: "power", roleId: "role-1", sections: ["role"], sourceIds: ["source-1"], crawl: false });
  });

  it("rejects a folder section absent from the response", () => {
    expect(validFolderSection("role", [summary()])).toBe(false);
    expect(validFolderSection("organisation", [summary()])).toBe(true);
  });
});