---
name: Review state, source refresh and occupation match rules
description: Non-obvious domain rules for pack readiness fingerprints, web-source refresh flagging and occupational dataset matches; read before changing readiness, refresh or occupation code.
---

- **Review state lives on the role profile, not the pack.** draft → in-review (any member) → ready (reviewer/admin, readiness must pass). A content fingerprint is stored at "ready"; any drift makes the effective state draft.
  **Why:** owner decision; a ready snapshot must equal what was reviewed.
  **How to apply:** the fingerprint must cover everything a pack can contain (role, organisation, findings, activities, questions, the source register including provenance, research-run errors) but be content-keyed — no ids, capture timestamps or refresh bookkeeping — so an unchanged refresh does not revert ready while a provenance-only source change does.

- **Refresh never mutates an earlier capture.** A new source supersedes the old; the diff is persisted on the new capture; the previous source and every affected finding get a version bump so edits opened before the refresh fail with 409 instead of silently clearing the re-review flag.

- **Flag per quotation, across the whole lineage, only on new disappearances.** Findings cite whichever capture they were made against, so a refresh checks every capture in the page's supersession chain; each citation is judged on its own (one newly missing quote flags the finding even if others were already missing and flagged earlier). Re-review after the change clears the flag; review status is never changed automatically.

- **Dataset-search matches are server-hydrated.** The client may only choose scheme, code, statements and rationale; identity fields come from the bundled entry, statements must belong to it, status is forced to proposed and a separate audited status route confirms it (owner: the researcher confirms). Manual matches keep the supplied app's behaviour.

- **Datasets are bundled JSON, not live APIs** (owner decision): ONS SOC 2020 (OGL v3) primary, O*NET (CC BY 4.0) supplementary labelled US. Refresh by re-running the import and committing; there is no database schema for them.
