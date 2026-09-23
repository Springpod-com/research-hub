# Aligning the research pack with the Client Knowledge Base (V1)

Status: built, 17 September 2026 (all four steps of §10). The API added for
it is described in `knowledge-base-api.md`; the export template copy lives in
`templates/`. Existing 1.0.0 packs are untouched and still download in every
format.

Reference: `Client_Knowledge_Base_Template` (six numbered folders, each with an
"About this folder" note, and `Springpod_LEARN_Client_Knowledge_Base_V1.docx`).

Decisions taken so far:

- **Words.** "Organisation" everywhere, in the app and in every export. The
  template's "employer" and "client" both become "organisation"; where the
  template needs to distinguish the company from the people at it who supply
  material or check facts, the export says "the organisation" and "the
  organisation's contact". Machine identifiers (ids, API paths, JSON keys in
  existing pack snapshots) do not change.
- **Exports.** All four: the filled document (DOCX), the six-folder knowledge
  base (ZIP, document included), Markdown in the eight sections, and the JSON
  snapshot as now.

## 1. What the template asks for

One document per organisation and role, read by the model first and kept
beside the storyboard. Eight sections, four tiers, six folders.

| # | Section (template) | Section (ours) | Folder (ours) | Default tier |
| --- | --- | --- | --- | --- |
| 1 | The employer | The organisation | 01-organisation | 2 |
| 2 | The role | The role | 02-role | 3, or 2 where the organisation's own pages say it |
| 3 | Case material | Case material | 03-case-material | 3 (numbers may be declared invented: 4) |
| 4 | Media | Media | 04-media | 2 for the organisation's own films, 3 for others |
| 5 | Brand | Brand | 05-brand | 2, or 1 if the organisation supplied guidelines |
| 6 | Client supplied | Supplied by the organisation | 06-organisation-supplied | 1 |
| 7 | Fact register | Fact register | — | every fact, with tier, source, date, parts, verified |
| 8 | Questions for the client | Questions for the organisation | — | answers come back at tier 1 |

Tiers: 1 supplied by the organisation (wins every conflict), 2 the
organisation's public material, 3 the profession, 4 illustrative (invented for
the case, declared, never presented as the organisation's own).

Vocabulary the document fixes and we keep: **fact**, **fact register**,
**tier**, **source**, **chapter**, **parts** of a chapter (A day in the role ·
Follow the workflow · What matters first · Make the call), **storyboard**, and
the storyboard's last page, which becomes **"For the organisation to
confirm"**. Files are named `YYYY-MM-DD_where-from_topic.ext` and logged.

The supplied V1 file stays as the reference. The export is produced from a
copy held in the repo (`docs/templates/`) with the word changes above applied
to its headings, header table, tier table, folder names and "About this
folder" notes, so the two never drift apart silently. Suggested title for the
copy: `Springpod_LEARN_Organisation_Knowledge_Base_V1.docx`.

## 2. Where the app already matches

- Every fact carries an exact quotation and a source; a fact cannot be saved
  unless the passage is found in the source (the template's "traceable to a
  file here").
- Questions record why they matter, whether they block, and where the answer
  came from; answers can be attributed to the organisation.
- Sources record whether they were public, supplied by the team, or confirmed
  by the organisation; the last of these is the template's tier 1.
- Readiness is not organisation approval. The approval flag in the pack is
  always false and the pack lists what still needs confirming: this is the
  "For the organisation to confirm" page in all but name.
- Packs are immutable, numbered revisions with a schema version, which is what
  lets the document format change without touching old exports.

## 3. Gaps

| Template | App today | Gap |
| --- | --- | --- |
| Four tiers on every fact and source | Facts are `company` / `occupation` / `proposal`; sources have a verification basis | No tier. Kind and verification imply one (see §4.1) but nothing records or shows it, and nothing marks tier 4 as declared. |
| Eight sections; facts placed in named slots (sites, size, how it talks about itself, the routine, safety rules…) | One flat evidence list per role | No placement. The export cannot be laid out as the document without it. |
| Tables with fixed columns: duties, adverts, vocabulary, measurements, faults, colours, type, media log, documents received, interview | Free-text claims only | No structured rows. |
| Which chapter parts a fact feeds | Activities (parked) | No `parts`. |
| Verified column; a verified row moves to tier 1 | Sources can be `client-confirmed`; facts cannot | No per-fact verification (by whom, when). |
| Header: the organisation as it writes its own name; the entity the learner meets; the role as the organisation names it; compiled by; started · last updated; who at the organisation checks facts | Name, division, role title, creator | No "who at the organisation checks facts". "Division" is the entity field but is not labelled so. |
| Media: transcript beside every film, timecodes for stills, rights note (supplied by the organisation · press kit · reference only) | Images with a caption; permission state | No films, transcripts, timecodes or rights notes. |
| Brand: guidelines provenance, logo rules, colours with hex and where seen, typefaces with licence, photography, house style, screenshots | One free-text "brand notes" field and a logo source | No structure. |
| Supplied by the organisation: documents received (from whom, what it settles), the interview (who, when, recording, transcript, eight questions, what it settled), names we may use, things we must not say | Uploads record the team member who uploaded, not the organisation's contact | No interview record, no allow/deny lists, no "what it settles" links. |
| Apprenticeship standard and its duties, NCS profile, professional body | UK SOC / O*NET occupation matches | Classification exists; the profession's own documents do not. |
| Dated file names in six folders; the document beside them | JSON and Markdown downloads | No folder export, no DOCX, no naming rule. |
| Consistent words | "Finding", "evidence register", "Employer fact" (an internal label), "Ask the organisation" | Small sweep needed (§8). |

## 4. Proposed model changes (all additive; old data reads unchanged)

### 4.1 Tier

`tier: 1 | 2 | 3 | 4` on every source and fact.

- Sources: default from what we already know. Supplied or confirmed by the
  organisation → 1. Web capture of the organisation's own pages, press kit,
  news or Wikipedia about it → 2. Occupation datasets, standards, professional
  bodies, guidance (HSE and the industry's own), manuals, trade press → 3. The
  researcher can override with a reason.
- Facts: the lowest-numbered tier among the cited sources; a fact with no
  citation is 4 and must say so in its rationale ("invented and declared").
  A fact verified by the organisation (see 4.4) becomes 1.
- Existing `kind` stays as the evidence rule (an occupation source cannot
  support an organisation fact); the tier is what the document shows.

### 4.2 Section and slot

`slot` on every fact, drawn from the template's labelled places:

`organisation.paragraph · organisation.entity · organisation.sites ·
organisation.products · organisation.size · organisation.voice ·
organisation.news · role.title · role.standard · role.duty · role.ncs ·
role.body · role.advert · role.day · role.vocabulary · case.routine ·
case.measurement · case.equipment · case.fault · case.safety · case.people ·
media.item · brand.guidelines · brand.logo · brand.colour · brand.type ·
brand.photography · brand.house-style · brand.screenshot · supplied.document ·
supplied.interview · supplied.may-use · supplied.must-not-say · none`

`none` keeps a fact in the register only (section 7). The export groups by
slot; nothing else changes about how a fact is reviewed or cited.

### 4.3 Structured rows

Some slots are table rows. They stay facts (same id, review, citations,
history, readiness) with typed `fields`:

| Slot | Fields |
| --- | --- |
| role.duty | duty, plainWords, part |
| role.advert | title, postedWhere, siteAndTeam, shiftPattern, systemsNamed[], fileSourceId, date |
| role.vocabulary | term, meaning |
| case.measurement | reading, unit, reviewLine, limit, origin (source or "invented and declared") |
| case.fault | problem, likelyCauses[], howChecked |
| brand.colour | name, hex, whereSeen |
| brand.type | face, whereUsed, licence |
| media.item | whatItShows, rights, transcriptSourceId, timecode |
| supplied.document | whatItIs, fromWhom, settles[] (question or fact ids) |
| supplied.interview | question (one of the eight, or ours), answerInTheirWords, timecode, usedIn[] |

The claim text is generated from the fields for display and for the register,
so one row is one fact everywhere.

### 4.4 Parts and verification

- `parts: ("day" | "workflow" | "matters" | "call")[]` on every fact: which
  chapter parts use it. This replaces the parked activities as the link between
  research and storyboard.
- `verified?: { by: string; at: string; note?: string }` on every fact, set by
  a reviewer when the organisation confirms a row. Verified facts export at
  tier 1.
- Section 7's "Verified" column and the "For the organisation to confirm" page
  are both computed from these two fields: rows at tiers 2–4 with at least one
  part and no verification.

### 4.5 Sources

- `folder: "01-organisation" | "02-role" | "03-case-material" | "04-media" | "05-brand" | "06-organisation-supplied"`
  with a default from kind and verification; overridable.
- New kinds: `film`, `advert`, `screenshot`, `standard`, `guidance`.
- `rights?: "organisation-supplied" | "press-kit" | "reference-only"`
  (required for media before a pack is ready).
- `transcriptSourceId?` for films; `timecode?` for stills lifted from films.
- `providedBy?: { name: string; jobTitle: string }` for material the
  organisation supplied (distinct from `suppliedBy`, the team member who
  uploaded it).
- `exportName`: computed `YYYY-MM-DD_where-from_topic.ext` from retrieval date,
  host or provider, and title. Shown in the source list so the on-disk folder
  and the document agree.

### 4.6 Organisation and role

- Organisation: `factChecker: { name: string; jobTitle: string } | "not yet known"`;
  `brand` block for prose (guidelines status and where they live, logo rules,
  photography, house style); `mayUse: string[]` and `mustNotSay: string[]`
  each with a source reference (tier 1 only).
- Role: `standard?: { name, level, duration, url, assessmentPlanUrl }` beside
  the SOC/O*NET matches (UK SOC stays the primary classification); `ncsUrl?`,
  `professionalBody?: { name, registrationRoute, frameworkUrl }`.
- Interview: `interview?: { who, jobTitle, timeInRole, mayBeNamed, date, how,
  recordingSourceId, transcriptSourceId }` on the role (one interview per pack).

### 4.7 Pack schema 2.0.0

New packs are `schemaVersion: "2.0.0"` with the same top-level shape plus
`tiers`, `sections` (facts grouped by slot in template order), `register`
(numbered rows), `toConfirm` (the last-page rows) and `header`. Existing 1.0.0
snapshots stay readable and downloadable; nothing is rewritten. The JSON
schema in `docs/` gets a v2 file next to v1. The existing approval key keeps
its name inside the JSON so that anything reading packs today keeps working;
every human-facing label says organisation.

## 5. Exports

1. **Markdown**: rewritten to the eight sections in the template's order with
   real tables, then the JSON block as now.
2. **DOCX**: the document filled in, produced from the repo copy of the V1
   template (§1) so the styles, headings and table layouts are the ones
   designers already know. Placeholders in square brackets are replaced; empty
   rows are dropped; unfilled slots are left as the template's bracketed prompt
   so a gap is visible rather than silent.
3. **Knowledge-base folder (ZIP)**: `01-organisation` … `06-organisation-supplied`
   with each source saved under its `exportName`, the six "About this folder"
   notes, and the DOCX at the top. Web captures are saved as the captured text
   with the address and date at the top; saving pages as PDF needs a browser on
   the server and is left for later if wanted.
4. **JSON**: the 2.0.0 snapshot, unchanged in role.

## 6. Research runs

- Instructions and output contract ask for `slot`, `parts`, structured
  `fields` for table slots, and a proposed tier with the rule that tier 1 is
  never the model's to assign.
- The run brief names what the document needs and does not have yet (empty
  slots), so a run fills gaps rather than restating what is registered.
- Everything else about exact quotations, questions and never inventing
  organisation facts stays as it is. Illustrative content is allowed only in
  the slots that permit it (measurements' origin "invented and declared") and
  is always tier 4.

## 7. Readiness (additions)

- Every media item in the pack has a rights note; every film has a transcript
  or a stated reason it has none.
- Every tier-4 fact says so in its rationale.
- Every measurement has an origin (source or declared invented).
- The organisation's fact checker is named or recorded as not yet known.
- Existing rules stay (reviewed facts, blocking questions answered, quotations
  still present after a refresh, no run in progress).

## 8. Terminology map

Direction: the app's word is "organisation"; the template's words are adapted
to it. Everything human-facing changes; ids, API paths and existing JSON keys
do not.

| Template says | App and exports say | Notes |
| --- | --- | --- |
| Employer | Organisation | Title becomes "[Organisation] · organisation knowledge base" |
| Client; client supplied | The organisation; supplied by the organisation | Tier 1 name, section 6, folder 06 |
| Who at the client checks facts | Who at the organisation checks facts | New header field |
| Questions for the client | Questions for the organisation | Section 8; question status "Ask the organisation" already matches |
| For the employer to confirm | For the organisation to confirm | The last page |
| The employer's public material | The organisation's public material | Tier 2 name |

| App today | App after | Where |
| --- | --- | --- |
| Finding | Fact | UI and exports; type names in code can follow later |
| Evidence register | Fact register | Export section 7, UI tab |
| Organisation fact / Occupational context / Design proposal | Tier 2 · Tier 3 · Tier 4, with the tier names above | Fact badges, filters, export |
| Employer fact (internal label, already shown as "Organisation fact") | removed | `shared/types.ts` labels |
| Questions and organisation input | Questions for the organisation | Export section 8 |
| Sources and materials | Sources, shown by folder | UI and export |
| Division | The entity the learner meets | Organisation form and header |
| Research lead | unchanged, plus "Who at the organisation checks facts" | Header |
| Accepted for drafting | Registered | Review state label |
| Ready for storyboard drafting | unchanged | |
| Research pack | unchanged as the object; the document is the "organisation knowledge base" | |
| Brand guidance and asset notes | Brand (section 5) | |
| Workplace image | Media (section 4) | |

## 9. Research workflow

Today the workflow is: add sources (one flat list, filtered only by role) →
press Research (focus and tier only; the run takes the newest sixteen readable
sources after crawling the website) → review a flat list of findings, one card
at a time, filtered only by review status → readiness checklist → pack. The
researcher is never told what the document still needs.

Built: the six folders are the unit of work for each organisation.

- **A folder per section.** The Evidence tab uses the six fixed sections and
  shows each folder's places, sources, gaps, review count and workflow status.
  The role, case-material and media folders are scoped to the selected role.
- **Add material.** A researcher can capture a page, upload a document, record
  a statement or add a Markdown team note to the relevant folder. Notes retain
  where their material was extracted from.
- **Automatic state.** A folder is gathering until a worker extracts at least
  one readable source, then it is extracted. There is no manual completion
  step.
- **Extract.** Research reads selected folder material and extracts facts and
  evidence into the section's places. Completion marks the folder extracted;
  material added afterwards is counted. Crawling the organisation website is
  optional rather than a required part of this workflow.
- **Keep supported facts.** Presentational differences in quotations are
  normalised during verification, while the exact captured wording is stored.
  Role-scoped runs may place supported facts in other folders without changing
  those folders' workflow status; organisation-wide runs cannot place facts in
  role-scoped folders.
- **Reviewed.** A reviewer or administrator can mark or unmark a folder
  reviewed without preconditions. A later extraction never silently removes
  that sign-off: it leaves the status reviewed and records that new facts need
  review.
- **Design notes and source trails.** Researchers can keep a designer's note
  at the top of each folder. Pack snapshots preserve it, while Markdown and
  DOCX exports finish every section with a "Sources read" table showing what
  each filed source contributed. Folder exports include the note as
  `00-designers-note.md`.

Not proposed: categorising sources by chapter or chapter part. One source
usually serves several parts, so the link to the chapter stays on the fact
(`parts`, §4.4), and the sections stay fixed at the template's six so that the
app, the folder on disk and the document agree. Free tags can be added later
if a team needs its own grouping.

## 10. Order of work

1. **Tiers, slots, parts, verification and terminology** (model, defaults for
   existing data, UI labels and badges, sections view with fill state, sources
   assigned to sections, research runs scoped to a section, Markdown export in
   eight sections, pack 2.0.0, the repo copy of the template with the word
   changes). Existing packs untouched.
2. **Structured rows and the new references**: forms and validation for the ten
   table slots; apprenticeship standard, NCS, professional body, interview,
   fact checker, may-use / must-not-say; research-run contract and brief
   updated to fill them.
3. **DOCX and folder exports**: template fill, `exportName` naming, ZIP.
4. **Readiness additions and the confirm page**: rights and transcript rules,
   declared tier-4, "For the organisation to confirm" as its own download.

Each step ships on its own, keeps the audit at zero findings, and adds tests
beside the existing ones (pack schema, readiness, export layout, naming).
