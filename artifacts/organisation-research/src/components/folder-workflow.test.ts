import { describe, expect, it } from "vitest";
import type { ResearchJob, SectionSummary } from "../../shared/types";
import {
  extractionSourceIds,
  noteRoleIds,
  retryResearchBody,
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
  ...overrides,
});

describe("folder workflow safeguards", () => {
  it("explains role and completion selection rules", () => {
    expect(sectionSelectionReason(summary({ roleScoped: true }), undefined)).toBe("Choose a role to use this folder");
    expect(sectionSelectionReason(summary({ status: { stage: "gathering", by: "", at: "" } }), "role-1")).toBe("Mark the folder complete first");
  });

  it("requires roles only for role-scoped notes", () => {
    expect(noteRoleIds("01-organisation", "role-1")).toEqual([]);
    expect(() => noteRoleIds("02-role")).toThrow("Choose a role");
    expect(noteRoleIds("02-role", "role-1")).toEqual(["role-1"]);
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