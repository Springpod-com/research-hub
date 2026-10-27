# Organisation Research: simplification audit

27 October 2026. Read-only audit of this repository and of Springpod Studio (`Springpod-com/Springpod-Studio-Main`, `main` at `a21ecd3`). No code was changed.

The question: what does Studio actually need from a research pack, what in this app is not used or is legacy, and how can making a pack become far less manual?

---

## Decisions, 27 October 2026 (Ollie)

| # | Question | Decision |
|---|---|---|
| 1 | Relax exact quotations to "flagged, not enforced" | **Yes** |
| 2 | Keep the upload virus scanner (ClamAV) | **Yes, keep it** |
| 3 | Drop the occupational data | **No. Keep it, make sure every pack includes it, and use its tasks as suggested WORK day tasks in Studio** |
| 4 | Make readiness advisory | **Yes** |
| 5 | Separate app or part of Studio | **Slim this app first, then migrate pack building into Studio** |

How this changes the rest of the document:

- **Occupations: keep, attached automatically.** Section 3 said drop; that no longer stands. Since 27 October, a pack made for a role with no recorded match carries the best UK SOC and the best O*NET match with their task statements, marked proposed. A researcher's own match for a scheme always wins. The matches go into the snapshot only; the role record is unchanged. Studio reads them and offers the tasks to the WORK day plan draft as suggestions, never as organisation facts.
- **ClamAV: keep.** Section 3's decision row is settled.
- **Step 10 is now the migration** of pack building into Studio, after steps 0 to 8. It replaces "Studio pulls packs by API".
- Decisions 6 and 7 of section 6 are answered by the above; brand and media (7) was not asked and stays open.

---

## 1. Summary

- **Studio reads one file.** From the ZIP it opens only `knowledge-base.json` (first match at any depth). The DOCX, Markdown, the six folders, the source files and the designer's notes are never read.
- **Studio reads about a third of that JSON.** It uses fact text, slot, tier, review state, register number and verified flag, plus a few organisation and role fields, questions, limitations and the "to confirm" list. It never reads quotations, locators, source text, occupational matches, the section structure, brand, media, activities, question answers or the header.
- **The expensive part of this app protects data Studio throws away.** Exact quotation matching drops roughly half of what the model extracts. On the Marriott rebuild, 17 to 24 candidate facts were dropped per pack. The quotation itself is then discarded by Studio's parser.
- **The output is worse than a hand-made document.** On Marriott the platform filled 17 of 33 places, and 15 of 33 on a re-run. The offline document filled 29 of 33 and was "much more useful as a narrative design brief" (`attached_assets/marriott-rebuild/comparison.md`).
- **The process has too many manual steps.** A pack needs:
  - two long forms (about 12 organisation fields and about 20 role fields)
  - material added one item at a time into six folders
  - one extraction run per folder (five on Marriott)
  - review per folder, plus clearing readiness rules such as rights notes, transcripts, tier-4 rationales, measurement origins and a named fact checker
  - a snapshot, a download, and an upload into Studio

**Recommendation:** keep the app separate for now, but cut it back to what Studio consumes and turn the flow into **Create → Drop material → Generate → Review → Export**. Section 6 lists the product rules that need Ollie's decision before the cuts can go ahead.

---

## 2. What Studio reads (the real contract)

Source: `lib/mechanics-content/src/research-pack.ts` (zod parser, unknown keys tolerated) and its consumers in `artifacts/api-server/src/routes/basic-authoring.ts` and `artifacts/api-server/src/lib/basic-*.ts`.

### Import fails without these

| Field | Rule |
|---|---|
| `knowledge-base.json` | In a ZIP (any depth), or uploaded bare. At most 8 MB; ZIP at most 50 MB and 2,000 entries |
| `schemaVersion` | Must match `2.x.x`. A 3.x pack is refused |
| `id`, `organisation.name`, `role.title` | Non-empty strings |
| `findings[]` | `id`, `claim` (non-empty), `tier` (number 1 to 4) |
| `register[]` | `n` (positive integer), `claim`, `tier` |
| Any string field | Must not be `null`. A `null` fails the whole import, because zod defaults only cover a missing key |

### Used by Studio's prompts and UI

| Field | Used for |
|---|---|
| `findings[].claim` | Every prompt (storyboard, LEARN Generate, WORK day plan, measurement, hub intro, lesson intros) and the storyboard grounding chips |
| `findings[].slot` | Groups facts in the grounding text; shown to the model per fact |
| `findings[].tier` | Sorts facts best evidence first, with caps (40 facts for lesson and hub intros, 120 for the day plan); shown in the trace label |
| `findings[].review`, `register[].verified` | Shown as verified or unconfirmed; the board warns on unconfirmed facts |
| `register[].n`, `register[].findingId` | The citation key "#n". **The WORK day plan can cite only facts that have a register number** |
| `findings[].citations[].sourceId` → source `title` / `filename` / `url` | Only the source names on storyboard board chips |
| `organisation.summary`, `country` | Storyboard, day plan, measurement and intro prompts |
| `organisation.mayUse`, `mustNotSay` | Every prompt. `mustNotSay` is also a hard check on storyboard rows |
| `role.seniority`, `location`, `responsibilities`, `boundaries` | Storyboard, day plan and measurement prompts. `location` sets where the role is based |
| `questions[].text`, `why` | Storyboard and measurement prompts; listed on the pack card |
| `limitations[]`, `toConfirm[].claim` | Prompts (as "never turn this into a fact") and the pack card |
| `employerApproval`, `status`, `revision` | Shown on the card and in the grounding text |

### Exported by this app but never read by Studio

- **Top level:** `header`, `tiers` (the legend), `sections` (the folder and slot structure), `activities`.
- **Findings:** `citations[].quote`, `citations[].locator`, `parts`, `rationale`, `history`, `runIds`.
- **Sources:** `text`, `kind`, `folder`, `tier`, `permission`, `verification`, `rights`, `exportName`, dates.
- **Organisation:** `website`, `brandNotes`, `brand`, `division`, `factChecker`.
- **Role:** `occupations` (UK SOC and O*NET matches), the apprenticeship standard, National Careers Service (NCS) profile, professional body and interview record, `reviewState`.
- **Questions:** `answer`, `status`, `blocking`, `assignee`, `provenance`.
- **Register and "to confirm":** everything except the fields listed in the table above.
- **The rest of the ZIP:** every other file. The DOCX, Markdown, source files, folder notes and `00-designers-note.md` are all ignored.

Studio does not need readiness either. It accepts draft packs; `status` is only displayed.

**Studio already has its own occupation data.** `lib/skills-framework` carries a SOC 2020 map.

### What Studio will need next

The LEARN and WORK authoring flow is already partly built in Studio: LEARN Generate, the WORK day plan and its build brief.

The six LEARN lessons and the day plan imply information needs that the current slot vocabulary covers only partly. This mapping is my reading, not a written requirement:

| Studio consumer | Helpful slots today | Missing |
|---|---|---|
| L1 Career overview | `role.day`, `organisation.paragraph`, `organisation.products` | |
| L2 Skills and training | `role.advert`, `role.duty`, `role.standard` | Entry routes as their own slot |
| L3 Career progression | `role.standard`, `role.body` | **Progression paths** (no slot) |
| L4 Daily activities | `case.routine`, `role.day` | |
| L5 Challenges and rewards | `case.fault`, `case.safety` | **Rewards** (no slot) |
| L6 Meet the expert | `supplied.interview`, `case.people` | |
| WORK day plan | `organisation.sites`, `case.equipment`, `case.people`, `case.routine` | **The tools the work happens in** (inbox, spreadsheet, system), which today is buried in `role.advert.systemsNamed` |

These slots do little for Studio: `brand.*` (colour, type, logo, photography, screenshot) and `media.item`. Studio's branding and media are set by the designer in Studio. A hex colour as a "fact" is noise in a lesson prompt.

---

## 3. What is in this app, and whether Studio needs it

Line counts are from today's source.

| Feature | Where | Studio needs it? | Recommendation |
|---|---|---|---|
| Organisation and role records | `server/app.ts`, `src/App.tsx` | Yes (name, title, summary, country, location, seniority, responsibilities, boundaries, may use, must not say) | **Keep**, with much shorter forms |
| Sources: upload, web capture, statement, note | `server/app.ts`, `server/retrieval.ts` | Yes (the input to extraction) | **Keep**. Replace one-at-a-time adding with one multi-file drop. Accept SVG, WebP and larger PDFs (all three were refused on Marriott) |
| AI extraction into slotted facts | `server/research.ts` | Yes (the core value) | **Keep and redesign** (section 4) |
| Fact register numbers, tiers, verified flag | `server/domain.ts` (`makePack`) | Yes | **Keep** |
| Questions and "to confirm" | `server/app.ts` | Yes (text and why) | **Keep**. Simplify: drop assignee, routing and provenance machinery |
| Exact quotation gate | `server/quotation.ts`, `validateCitations` | No (the quotation is discarded) | **Relax**: keep the source id; a quote that cannot be found is flagged, not dropped |
| Six folders, folder workflow states, reviewed tick, designer's notes per folder | `folder-workflow.ts`, `folder-view.tsx`, `sections-view.tsx`, section routes | No | **Simplify**: sort sources automatically (the derivation already exists); drop folder states and ticks |
| Readiness rules (rights notes, film transcripts, tier-4 rationale, measurement origin, fact checker, blocking questions) | `readiness()` in `server/domain.ts` | No | **Drop**, or keep as one advisory list |
| Role review state (draft → in review → ready) and content fingerprint | `server/domain.ts` | No | **Drop**. Status becomes a label |
| Source refresh, sentence diff, supersession, re-review flags | `server/app.ts`, `captureDiff`, `captureLineage` | No | **Drop**. Re-capture is just a new source |
| Occupation matching (UK SOC + O*NET) | `server/occupations.ts` (307), `shared/occupations.ts` (65), `occupation-matcher.tsx` (523), `scripts/occupations/import.mts` (317), 4.8 MB of bundled JSON | Yes since 27 October (tasks suggest WORK day tasks) | **Keep**; matched automatically into every pack (see Decisions) |
| Activity candidates (parked since 16 September) | Types, routes, `ACTIVITIES_PARKED`, export field | No | **Drop** (keep an empty `activities` key only if old consumers need it; Studio does not) |
| Structured table rows (10 slot types with typed fields) | `slotFields`, `structuredFinding` | No (only the generated claim text is read) | **Keep claim text only**; drop typed fields except where they produce better claims |
| Apprenticeship standard, NCS, professional body, interview, fact-checker forms | `src/App.tsx` (role and organisation forms) | No | **Drop the forms**; this material becomes ordinary sources and facts |
| Brand and media sections | Slots, rights, transcripts, timecodes | No | **Drop from extraction** |
| DOCX export, six-folder ZIP with source files, `confirm.md` | `server/export.ts` (707 lines in total) | No | **Replace** with `knowledge-base.json` plus one Markdown file for people to read |
| Pack snapshots in SQL with an immutability trigger | `server/store.ts` | Not by Studio (Studio stores its own immutable import rows) | Keep simple versioned snapshots; the trigger is optional |
| Model settings page: four model slots, live probe, editable prompt with versions | `research-settings.tsx` (470), `server/models.ts` (162), settings routes | No | **Drop**. One model ID in an environment variable, prompt in code |
| Economy / Power / Max tiers, two-model Max analysis | `server/research.ts` | No | **Drop**. Use one strong model |
| Likely-duplicate organisation suggestions | `suggestOrganisations` | No | Optional; low cost to keep |
| ClamAV sidecar (about 1 GB RAM; the cause of the September VM hangs) | `scripts/clamav/*`, `UPLOAD_SCAN_COMMAND` | No | **Decision needed** (section 6). Studio scans nothing on its own uploads |
| Clerk + membership + invitations | `server/members.ts`, `server/clerk-proxy.ts` | No (access control only) | Keep while separate; goes away if merged into Studio |
| App Registry heartbeat | `server/registry.ts`, `scripts/registry-heartbeat.ts` | No | Keep (organisation-wide requirement) |
| `artifacts/mockup-sandbox`, `scripts/src/hello.ts` | Replit template leftovers | No | **Delete** |
| `attached_assets/` (39 MB in git, including a 37 MB Marriott ZIP) | Repo root | No | **Move out of git** |

### Structural issues that make every change slower

- **One React file, 4,687 lines** (`src/App.tsx`), and one Express file, 2,519 lines (`server/app.ts`), with 45 routes.
- **The whole workspace is one JSON document in one Postgres row**, rewritten on every change and polled every 3 to 12 seconds. This is a known source of production instability (`.agents/memory/workspace-document-load.md`). Cutting the features above shrinks the document. Proper tables are the longer-term fix.
- **Three generations of the model live side by side:** v1 packs, v2 packs, a "simplified approval" migration and a "section status" migration. Each new feature has to stay compatible with all of them.

---

## 4. The streamlined flow

### Today

1. Create the organisation (about 12 fields, including brand blocks and a fact checker).
2. Create the role (about 20 fields, including the apprenticeship standard, NCS, professional body and interview).
3. For each of six folders, add material one item at a time and set folder, tier, rights and transcript.
4. For each folder, pick the section and sources, then run an extraction (20 to 270 seconds each).
5. Review facts folder by folder. Clear the readiness rules. Match occupations. Answer or defer questions.
6. Send for review. A reviewer marks the profile ready. Create a snapshot.
7. Download the ZIP and upload it to Studio.

### Proposed

1. **New pack.** Organisation name and website; role title and location; paste the job advert or responsibilities.
2. **Drop material.** One drop zone for files or a ZIP of any layout, plus the website crawl, which is on by default. Sources are sorted into sections automatically. No per-item forms.
3. **Generate.** One button. The server runs every section in parallel and reports one progress bar. Facts keep their source id. A quote that cannot be matched is shown with a flag instead of being dropped. Every empty place the next Studio stage needs becomes a question or a "to confirm" line.
4. **Review.** One page grouped by section. Each fact has keep or exclude, edit, and a source link. Gaps and questions sit beside it. Add a fact or a client answer by hand.
5. **Export.** `knowledge-base.json` (the same 2.x contract) plus one Markdown file for people to read. Later, optionally, a "Send to Studio" button or a Studio "Import from Organisation Research" picker instead of download and upload.

That takes the flow from seven stages and dozens of actions to five stages and about six actions. Generate quality goes up because nothing useful is thrown away by the verbatim-quote gate. The designer still sees which facts are unconfirmed.

### Contract safety for every step

- **Add a contract test here.** Every exported pack should parse with a copy of Studio's `knowledgeBaseSchema`, and the test should include "no `null` strings".
- **Keep `schemaVersion` on 2.x.** Do not remove any field from the "Import fails without" list. Removing exported-but-unread fields is safe for Studio.
- **Check old packs.** Existing packs already imported into Studio are stored there as their own rows, and nothing here changes them.

---

## 5. Suggested order of work

Each step is its own task. Each one is behaviour-preserving for Studio and has its own check.

| # | Task | Verify |
|---|---|---|
| 0 | Housekeeping: delete `mockup-sandbox` and `scripts/src/hello.ts`; move `attached_assets` out of git | App builds, tests green, repo size drops |
| 1 | Contract test against Studio's parser, including a `null` check | Test fails on a pack with a `null` summary, passes on current exports |
| 2 | Single model and fixed prompt; remove tiers, the settings page and Max | One research run works end to end; settings routes gone |
| 3 | Remove activities, source refresh and diff, review state and fingerprint (occupations stay) | Pack JSON still passes the contract test; existing snapshots still download |
| 4 | Relax the quotation gate to "flag, don't drop" | Re-run Marriott: retained facts and filled places both rise against the 17/33 baseline |
| 5 | One Generate: parallel sections, one progress view | Marriott pack from one click |
| 6 | One-drop upload with automatic sorting; accept SVG and WebP; raise the PDF limit | The Marriott material uploads in one action |
| 7 | One review page; shorter organisation and role forms; drop brand and media extraction | A new pack takes about six actions |
| 8 | Exports: JSON plus Markdown only | Studio imports it; no DOCX or folder ZIP |
| 9 | Re-cut slots around Studio's six lessons and the WORK day plan (progression, rewards, entry routes, tools) | Studio's LEARN Generate and day plan cite more facts from a fresh pack |
| 10 | Migrate pack building into Studio (decided 27 October) | Needs its own plan and a Studio decision record; Studio's CLAUDE.md currently names this app as the schema owner |

---

## 6. Decisions needed from Ollie before cutting

These are product rules written into `replit.md` and `docs/REPLIT-HANDOVER.md`. The simplification conflicts with them, so they need an explicit decision rather than a quiet removal.

1. **Exact quotations for every fact.** Relax to "source id required; quote checked and flagged, not enforced"?
2. **Upload scanner (ClamAV) required in production.** Keep it, swap to a hosted scanner, or drop it for an internal-only staff tool? Studio does not scan its own uploads.
3. **Occupational data (UK SOC and O*NET) with full provenance.** Drop it, given that Studio never reads it and has its own SOC map?
4. **Readiness and the reviewer "ready" gate.** Make them advisory or remove them, given that Studio accepts drafts?
5. **"No automated Studio delivery."** Allow a "Send to Studio" or "Import from Organisation Research" path later?
6. **Separate app or part of Studio?** Studio already has Clerk, object storage, AI drafting with long-running runs, and a research pack table per experience. Moving pack building into Studio's Set up step would remove a whole deployment (Clerk app, Postgres, VM, ClamAV). It is a larger change, and Studio's CLAUDE.md currently treats this app as the schema owner. My recommendation is to slim this app first (steps 0 to 8), then decide.
7. **Brand and media sections.** Drop them from the pack, given that Studio handles branding and media itself?

---

## 7. What I could not check

- I did not run either app, the tests, or a live research run. The Marriott figures come from `attached_assets/marriott-rebuild/comparison.md`.
- The per-lesson slot mapping in section 2 is my reading of the lesson catalogue. No plan or decision in Studio writes down per-lesson information needs.
- Whether any person or process outside Studio relies on the DOCX, the folder ZIP or `confirm.md`, for example for client fact-checking. Studio does not.
