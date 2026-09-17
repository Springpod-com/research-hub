import { describe, expect, it } from "vitest";
import {
  base,
  HttpError,
  readiness,
  structuredFinding,
  validateOrganisationReferences,
} from "../server/domain.js";
import { sampleWorkspace } from "./fixtures.js";

describe("knowledge-base step 2 structured rows", () => {
  const workspace = sampleWorkspace();
  const orgId = workspace.organisations[0].id;
  const source = workspace.sources[0];

  it("validates fields and generates claims for three table slots", () => {
    expect(structuredFinding(workspace.sources, orgId, "role.duty", {
      duty: "Inspect deliveries",
      plainWords: "Check what arrived",
      part: "workflow",
    }, []).claim).toBe("Inspect deliveries — Check what arrived");
    expect(structuredFinding(workspace.sources, orgId, "role.vocabulary", {
      term: "Variance",
      meaning: "The difference from the expected quantity",
    }, []).claim).toBe("Variance — The difference from the expected quantity");
    expect(structuredFinding(workspace.sources, orgId, "case.fault", {
      problem: "Count does not match",
      likelyCauses: ["missed item", "duplicate scan"],
      howChecked: "recounting",
    }, []).claim).toBe("Count does not match; likely causes missed item, duplicate scan; checked by recounting");
    expect(() => structuredFinding(workspace.sources, orgId, "role.duty", {
      duty: "Inspect",
      unexpected: "no",
    }, [])).toThrow(HttpError);
  });

  it("enforces invented measurement and source-origin rules", () => {
    expect(structuredFinding(workspace.sources, orgId, "case.measurement", {
      reading: "42",
      unit: "units",
      reviewLine: "40",
      limit: "50",
      origin: "invented and declared",
    }, []).claim).toBe("42 units; review line 40; limit 50 (invented and declared)");
    expect(() => structuredFinding(workspace.sources, orgId, "case.measurement", {
      reading: "42",
      origin: "invented and declared",
    }, [{ sourceId: source.id, quote: "x", locator: "x" }])).toThrow(
      "must not have citations",
    );
    expect(structuredFinding(workspace.sources, orgId, "case.measurement", {
      reading: "42",
      origin: source.id,
    }, []).claim).toContain(`(${source.id})`);
  });

  it("requires tier-1 organisation sources for attributed names", () => {
    expect(() =>
      validateOrganisationReferences(workspace.sources, orgId, [
        { sourceId: source.id },
      ]),
    ).toThrow("tier-1 source");
    source.verification = "client-confirmed";
    expect(() =>
      validateOrganisationReferences(workspace.sources, orgId, [
        { sourceId: source.id },
      ]),
    ).not.toThrow();
  });

  it("validates source-valued and record-valued structured fields", () => {
    const other = sampleWorkspace();
    const foreignSource = other.sources[0];
    expect(() =>
      structuredFinding(
        workspace.sources,
        orgId,
        "role.advert",
        { title: "Coordinator", fileSourceId: foreignSource.id },
        [],
      ),
    ).toThrow("must belong to this organisation");
    expect(() =>
      structuredFinding(
        workspace.sources,
        orgId,
        "supplied.document",
        { whatItIs: "Brief", settles: ["fabricated-id"] },
        [],
      ),
    ).toThrow("must belong to this organisation");
    expect(() =>
      structuredFinding(
        workspace.sources,
        orgId,
        "supplied.document",
        { whatItIs: "Brief", settles: [other.questions[0].id] },
        [],
        workspace,
      ),
    ).toThrow("must belong to this organisation");
  });
});

describe("knowledge-base readiness additions", () => {
  it("reports each missing media, tier, measurement and fact-checker requirement", () => {
    const workspace = sampleWorkspace();
    const organisation = workspace.organisations[0];
    const role = workspace.roles[0];
    const source = workspace.sources[0];
    workspace.findings[0].review = "accepted";
    organisation.factChecker = undefined;
    workspace.sources.push(
      {
        ...source,
        ...base(),
        kind: "image",
        title: "Workplace image",
        text: "",
      },
      {
        ...source,
        ...base(),
        kind: "film",
        title: "Role film",
        text: "",
      },
    );
    workspace.findings.push(
      {
        ...workspace.findings[0],
        ...base(),
        kind: "proposal",
        citations: [],
        slot: "media.item",
        fields: { whatItShows: "The workplace", rights: "" },
        rationale: "A scene for the case.",
      },
      {
        ...workspace.findings[0],
        ...base(),
        kind: "proposal",
        citations: [],
        slot: "case.measurement",
        fields: { reading: "42", origin: "" },
        rationale: "Illustrative value.",
      },
    );

    const issues = readiness(workspace, organisation.id, role.id);
    expect(issues).toContain("Add a rights note to every media item.");
    expect(issues).toContain(
      "Add a transcript for every film, or state why there is no transcript.",
    );
    expect(issues).toContain(
      "State that every tier-4 fact is invented or illustrative in its rationale.",
    );
    expect(issues).toContain("Add an origin to every case measurement.");
    expect(issues).toContain(
      "Name the organisation's fact checker or record them as not yet known.",
    );
  });

  it("accepts recorded unknown contacts, media reasons and declared facts", () => {
    const workspace = sampleWorkspace();
    const organisation = workspace.organisations[0];
    const role = workspace.roles[0];
    const source = workspace.sources[0];
    workspace.findings[0].review = "accepted";
    workspace.sources.push({
      ...source,
      ...base(),
      kind: "film",
      title: "Role film",
      text: "",
      rights: "reference-only",
      caption: "There is no transcript for this silent film.",
    });
    workspace.findings.push({
      ...workspace.findings[0],
      ...base(),
      kind: "proposal",
      citations: [],
      slot: "case.measurement",
      fields: { reading: "42", origin: "invented and declared" },
      rationale: "An illustrative measurement.",
    });

    const issues = readiness(workspace, organisation.id, role.id);
    expect(issues).not.toContain("Add a rights note to every media item.");
    expect(issues).not.toContain(
      "Add a transcript for every film, or state why there is no transcript.",
    );
    expect(issues).not.toContain(
      "State that every tier-4 fact is invented or illustrative in its rationale.",
    );
    expect(issues).not.toContain("Add an origin to every case measurement.");
    expect(issues).not.toContain(
      "Name the organisation's fact checker or record them as not yet known.",
    );
  });

  it("uses the effective media folder for rights and transcript checks", () => {
    const workspace = sampleWorkspace();
    const organisation = workspace.organisations[0];
    const role = workspace.roles[0];
    workspace.findings[0].review = "accepted";
    workspace.sources.push({
      ...workspace.sources[0],
      ...base(),
      kind: "image",
      folder: "05-brand",
      title: "Brand image",
      text: "",
    });
    expect(readiness(workspace, organisation.id, role.id)).not.toContain(
      "Add a rights note to every media item.",
    );
    workspace.sources.push({
      ...workspace.sources[0],
      ...base(),
      kind: "screenshot",
      folder: "04-media",
      title: "Media screenshot",
      text: "",
    });
    expect(readiness(workspace, organisation.id, role.id)).toContain(
      "Add a rights note to every media item.",
    );
    workspace.sources.push({
      ...workspace.sources[0],
      ...base(),
      kind: "film",
      folder: "04-media",
      title: "Film without transcript",
      text: "",
      rights: "reference-only",
      tierReason: "A tier override, not a transcript reason.",
    });
    expect(readiness(workspace, organisation.id, role.id)).toContain(
      "Add a transcript for every film, or state why there is no transcript.",
    );
  });

  it("re-checks attributed tier-1 references at readiness", () => {
    const workspace = sampleWorkspace();
    const organisation = workspace.organisations[0];
    const role = workspace.roles[0];
    workspace.findings[0].review = "accepted";
    workspace.sources[0].tier = 2;
    organisation.mayUse = [
      { text: "Northstar", sourceId: workspace.sources[0].id },
    ];
    expect(readiness(workspace, organisation.id, role.id)).toContain(
      "A name we may use or a thing we must not say cites a source that is no longer tier 1.",
    );
  });
});