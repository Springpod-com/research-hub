---
name: Extraction yield on real packs
description: What a real folder-first rebuild (Marriott, 30 sources, 2026-09-22) showed about fact yield, exclusions and run-to-run variance; read before tuning the worker prompt or verification.
---

- Five folder runs produced 26 facts / 17 of 33 places; ~17 candidates were dropped as "quotation or evidence category could not be verified". After adding tolerant quotation matching (NFKC, quotes, dashes, whitespace, case) and cross-folder placement, a clean re-run gave 17 facts / 15 places with 24 exclusions — formatting was not the cause.
  **Why:** the model paraphrases or quotes text absent from the captured/extracted source text (PDF extraction differs from what it "reads"), and one run per folder is a single noisy draw (case folder: 6 facts then 2).
  **How to apply:** before changing the matcher again, make exclusion job errors specific (source, reason class, quote excerpt) and compare several runs; consider prompt-side verbatim-quote instructions or a nearest-sentence repair step. The tolerant locator must still return the exact source span and reject partial matches inside NFKC expansions.
