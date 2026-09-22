import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { validateCitations } from "../server/domain.js";
import {
  buildQuotationIndex,
  locateQuotation,
} from "../server/quotation.js";
import { sampleWorkspace } from "./fixtures.js";

describe("knowledge-base Step 7 quotation matching", () => {
  it.each([
    {
      name: "curly quotation marks",
      source: "They call it “the ‘daily’ check”.",
      quote: `They call it "the 'daily' check".`,
    },
    {
      name: "non-breaking spaces",
      source: "The team\u00a0checks\u00a0stock.",
      quote: "The team checks stock.",
    },
    {
      name: "em dashes",
      source: "Check the total—then record it.",
      quote: "Check the total-then record it.",
    },
    {
      name: "line-wrapped text",
      source: "Prepare a clear\nshift handover.",
      quote: "Prepare a clear shift handover.",
    },
    {
      name: "ellipsis characters",
      source: "Check… record… hand over.",
      quote: "Check... record... hand over.",
    },
    {
      name: "case differences",
      source: "Coordinators Record Quantity Differences.",
      quote: "coordinators record quantity differences.",
    },
  ])("returns the exact original span for $name", ({ source, quote }) => {
    expect(locateQuotation(`Before ${source} After`, quote)).toBe(source);
  });

  it("returns null for a genuinely absent quotation", () => {
    expect(
      locateQuotation("The team checks stock.", "The team invents stock."),
    ).toBeNull();
  });

  it.each([
    { source: "xﬃy", partial: "fi", full: "ffi", exact: "ﬃ" },
    { source: "x…y", partial: "..", full: "...", exact: "…" },
    { source: "xİy", partial: "i", full: "i\u0307", exact: "İ" },
  ])(
    "rejects a match ending inside a normalised expansion in $source",
    ({ source, partial, full, exact }) => {
      const index = buildQuotationIndex(source);
      expect(locateQuotation(index, partial)).toBeNull();
      expect(locateQuotation(index, full)).toBe(exact);
    },
  );

  it("normalises decomposed combining marks across code points", () => {
    expect(locateQuotation("A Cafe\u0301 closes.", "A Café closes.")).toBe(
      "A Cafe\u0301 closes.",
    );
  });

  it("case-folds sharp s without losing source offsets", () => {
    expect(locateQuotation("Die Straße ist lang.", "DIE STRASSE IST LANG."))
      .toBe("Die Straße ist lang.");
    expect(locateQuotation("Die Straße ist lang.", "die strasse ist lang."))
      .toBe("Die Straße ist lang.");
  });

  it("tracks dotted capital I through its folded expansion", () => {
    expect(locateQuotation("İstanbul", "i\u0307stanbul")).toBe("İstanbul");
    expect(locateQuotation("İstanbul", "istanbul")).toBeNull();
  });

  it("validates 300 citations against one 200k source in under a second", () => {
    const workspace = sampleWorkspace();
    const source = workspace.sources[0];
    source.text = `${"x".repeat(199_950)} The Straße team closes the café.`;
    const quotationIndexes = new Map();
    const citations = Array.from({ length: 300 }, () => ({
      sourceId: source.id,
      quote: "the STRASSE team closes the cafe\u0301.",
      locator: "Performance fixture",
    }));

    const started = performance.now();
    validateCitations(
      workspace.sources,
      source.orgId,
      "company",
      citations,
      quotationIndexes,
    );
    const elapsed = performance.now() - started;

    expect(quotationIndexes).toHaveLength(1);
    expect(elapsed).toBeLessThan(1_000);
  });
});