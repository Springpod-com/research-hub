# Implementation status — 16 September 2026

## What is built

This is an executable, standalone MVP, with a React frontend, authenticated API, persistent storage, a bounded research worker, evidence review and immutable exports. No Employer Intelligence backend, database or production system was used.

| Requirement | Current implementation | Remaining work or limit |
| --- | --- | --- |
| FR-01 Organisations | Create/edit, search/filter/sort, division scope, duplicate name/domain guard; likely existing records are suggested while typing (same domain, same/similar name, with the reason shown) and can be opened instead | Suggestions are lexical (domain, normalised name, bigram similarity), not a company registry lookup |
| FR-02 Role scope | Employer title, location, seniority, responsibilities, boundaries | Country belongs to organisation; unknowns remain explicit |
| FR-03 Public research | Homepage plus up to three relevant same-origin links; manual URL capture; stored excerpts/dates; durable queue, cancellation and partial failure reporting | No search-engine discovery; live provider/network run still needs deployment credentials |
| FR-04 Uploads | PDF/DOCX/TXT/Markdown and PNG/JPEG; type/size validation; PDF page markers; empty-text warnings | No OCR; production scanner must be provisioned; extraction under hostile production workloads needs operational review |
| FR-05 Evidence | Exact source quotations (matched ignoring line breaks, spacing and typographic quote marks only), stable source references, same-organisation checks, recorded statements | Exact quotation validates provenance, not the semantic truth of the claim; human review remains necessary |
| FR-06 Classification | Employer facts, occupation context and proposals in UI/exports | User-supplied classification remains reviewable |
| FR-07 Review | Edit claim/category/notes, accept, exclude, request clarification; previous content and reviewer recorded | Conflict resolution is human review; no automated adjudication |
| FR-08 Occupation matching | Bundled official datasets (UK SOC 2020 primary, O*NET supplementary) with deterministic keyword candidate matching from the role title, seniority and responsibilities; matched terms shown as the rationale; matches recorded as proposed with scheme, code, dataset version, source URL, jurisdiction, retrieval date and basis; manual records still supported | Matching is lexical, not a published SOC↔O*NET crosswalk or a model; datasets refresh by re-running the import and committing the JSON |
| FR-09 Occupational context | Dataset tasks, work activities, skills, knowledge, work context and ONS entry routes are shown per candidate; the researcher selects which statements to keep and they are stored with the match; manual entry remains | O*NET statements are US data and are labelled as such; relevance to the UK role is a human judgement |
| FR-10 Questions | Create, answer with provenance, defer, route to client, assignee; blocking questions gate readiness | Clients provide answers through the team; no outbound messaging |
| FR-11 Activities | Model prompt requests six to eight proposals when evidence supports them; human/manual proposals and accept/exclude | Counts are not padded when evidence is insufficient. Max may retain separate proposals from both models; no semantic merge |
| FR-12 Research pack | Reviewed role/organisation, classified findings, source register, occupations, activities, questions and limitations; role profile review state draft → in review → ready (reviewer/admin only, readiness checks enforced) with a content fingerprint that returns the profile to draft after any edit; ready snapshots require a ready profile | Workplace/shift narrative is not automatically assembled |
| FR-13 Exports | Versioned Markdown and JSON generated from one snapshot, stable IDs/schema | Binary source assets are referenced, not bundled |
| FR-14 History | Prior finding text/status/reviewer; audit events; optimistic edits; SQL-enforced immutable packs; web-source refresh creates a linked new capture with an added/removed sentence diff and flags findings whose quotation disappeared (blocks readiness until re-reviewed) | Refresh is manual per source; there is no scheduled re-crawl or notification to existing pack consumers, and historical snapshots remain unchanged by design |
| FR-15 Clerk | Clerk browser/server integration, approved members and researcher/reviewer/admin permissions, production configuration guard | Actual organisational SSO, domains, membership and live denial tests must be configured/verified in Replit |

## Frontend reuse

The starter's README, implementation guidance and dependency guidance were read before implementation. Only its portable `research-workspace-page.tsx` and stylesheet pattern were reused (formatting may differ); the starter's `table-kit.ts` sizing constants were retired because data tables use the design system's `DataTable`, which owns its own toolbar, header, cell and pagination layout. Reference screens informed layout and evidence-panel patterns; the old application and its backend dependencies were not copied. All UI primitives, icons and toast facilities come from `@springpod/design-system` v0.2.0. The main stylesheet is its single import. Bundled Poppins and other package fonts are in the production build; no external font links are used.

## Local verification

- Automated tests: 39 passed (Vitest). Phase 2 additions cover dataset loading and version labels, deterministic candidate ranking with matched-term rationale, dataset-search match recording with server-side hydration (forged identity fields ignored, foreign statements rejected, status forced to proposed, confirm transition), review-state permissions and fingerprint reversion (unchanged refresh keeps ready; source edits, provenance-only source additions and research-run errors revert it), ready-snapshot gating on review state, organisation likely-match suggestions, and source refresh (supersession links, persisted sentence diff, per-quotation flagging across the capture lineage, stale-save 409 after refresh, readiness block, 409/422 guards). Earlier tests cover failed-closed setup, untrusted origins, exact quotes, cross-organisation evidence, readiness gates, review history, stale updates, answer provenance, role restrictions, invalid uploads, JSON/Markdown parity, increasing pack revisions, SQL snapshot immutability, private/reserved network address rejection, and one-provider failure with partial-result retention and invented-quote rejection.
- TypeScript check passed.
- `npx springpod-audit src` passed with exit code 0.
- Production frontend build passed. Vite reports a non-blocking large-JavaScript-chunk warning; route splitting is a future performance improvement.
- Browser journey completed using the clearly labelled fictional preview: directory → organisation → inspect exact evidence → accept finding → accept activity → create a ready snapshot. Desktop layout visually inspected, including the role review-state controls and a recorded dataset-search match with its provenance badges.
- Tests use embedded PostgreSQL-compatible PGlite and mocked AI responses. They are not tests against deployed PostgreSQL, a real identity provider or live AI services.

## Live setup still required

On Replit: the project's dedicated PostgreSQL database, Replit-managed Clerk (with the bootstrap administrator email), Replit AI-integration proxies, owner-chosen exact model IDs and the in-project ClamAV scanner are configured. Still owner-owned: enterprise SSO connection and approved domains in Clerk; a small live research run against real material; production access-denial checks with a second, non-member account; mobile/tablet and keyboard acceptance review; database backups and retention policy.

## Product extensions deliberately not claimed

- Two independent web-discovery runs: current Max performs independent analyses of shared captured sources.
- AI workplace-image interpretation: current images have inspection, contextual notes and permissions only.
- Organisation logo assignment: images and brand guidance can be recorded, but no dedicated selected-logo control exists.
- Automatic semantic deduplication, conflicting-claim detection or reconciliation.
- Estimated currency cost, provider budgets, source-retention/erasure workflow or per-organisation access policies. The current product is one approved internal team workspace.
- Cross-app synchronisation, the Employer Intelligence field catalogue and approval machinery, or automated Studio delivery.

Agree retention/erasure policy before real data is loaded. Immutable snapshots contain copied research text; deleting a source alone would not erase that text. The current app intentionally provides no casual deletion button.
