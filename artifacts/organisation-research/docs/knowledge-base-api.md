# Knowledge-base layer: contract between server and client

Companion to `knowledge-base-alignment.md` (the plan). Types live in
`shared/types.ts` (`Tier`, `Section`, `Folder`, `slots`, `Slot`, `Part`,
`Verified`, `Rights`, `PackV2`, `RegisterRow`). Ids, existing API paths and
existing JSON keys never change. British English everywhere a person reads.

## Server-computed fields (filled on every read, never stored by the client)

- `Source.folder` when absent: `providedBy` set or `verification ===
  "client-confirmed"` → `06-organisation-supplied`; kind `image` | `film` →
  `04-media`; `screenshot` → `05-brand`; `advert` | `standard` | `guidance` |
  `occupation` → `02-role`; everything else → `01-organisation`. A stored
  `folder` always wins (`03-case-material` is only ever chosen by a person).
- `Source.tier` when absent: `providedBy` set or `client-confirmed` → 1;
  kind `occupation` | `standard` | `guidance` → 3; otherwise 2. A stored
  `tier` wins and requires `tierReason`.
- `Finding.tier`: `verified` → 1; no citations → 4; else the lowest tier among
  cited sources.
- `Source.exportName`: `YYYY-MM-DD_where-from_topic.ext` — date from
  `retrievedAt`; where-from = URL host without `www.` for web, `organisation`
  when tier 1, else `team`; topic = title slugified (lower-case, hyphens, ≤ 60
  chars); ext from `filename`, else `txt`.
- `Finding.slot` absent means `"none"`; `parts` absent means `[]`.

## Endpoints

### `GET /api/orgs/:orgId/sections?roleId=<id>` (roleId optional = whole organisation)

```
{ sections: [{ section, folder, title, roleScoped,
               slots: [{ slot, label, table, findingIds: string[], filled: boolean }],
               filled: number, total: number, sourceIds: string[], gaps: string[] }],
  missing: string[] }          // "The role: Duties" … for every empty slot in scope
```
`findingIds` are non-rejected findings in scope (org-wide, or the role); a
slot is filled when it has at least one. `sourceIds` are the sources whose
(derived) folder is the section's, in scope. Any signed-in member may read.

### `PATCH /api/sources/:id`
Accepts, in addition to today's fields: `folder`, `tier` + `tierReason`
(reason required when tier is set; `tier: null` clears the override),
`rights`, `transcriptSourceId`, `timecode`, `providedBy` (`{name, jobTitle}`
or null). Enums validated with zod; audited like other edits.

### `PATCH /api/findings/:id`
Accepts, in addition to today's fields: `slot`, `parts`, `fields`, and
`verified: { note?: string } | null`. Only `reviewer` and `admin` may set or
clear `verified`; the server fills `by` (session name) and `at`. Every change
is recorded in the finding's history as today.

### `POST /api/questions/:id/fact` body `{ slot: Slot, parts?: Part[], claim?: string }`
Only for a question whose status is `answered` with a non-empty answer.
Creates a `statement` source (verification `client-confirmed`, folder
`06-organisation-supplied`, text = the answer, locator = `Answer to question
<id>`, `providedBy.name` = `answeredBy` when present, suppliedBy = the session
name) and a finding (kind `company`, claim = `claim` or the answer, one
citation quoting the answer, review `unreviewed`, the given slot and parts,
`runIds: []`). Returns `{ source, finding }`. Researchers and above.

### `POST /api/research` (existing) — new optional body fields
- `sections: Section[]` — sections the run should fill.
- `sourceIds: string[]` — the exact sources to read (≤ 16, all in the
  organisation and in scope, readable; otherwise 422).
Both are stored on the job. Worker: when `sourceIds` is given, read exactly
those and skip the website crawl; when only `sections` is given, take the
newest 16 sources whose folder is one of the selected sections plus
`01-organisation`; otherwise behave as today. The brief gains a "Places to
fill" list (the `missing` entries for the selected sections, or all) and the
slot vocabulary. The output contract gains, per finding, `slot` (one of the
slot ids or `none`; unknown values become `none`) and `parts`
(subset of `day`, `workflow`, `matters`, `call`). Tier is never asked of the
model; it is derived.

### Packs
New packs are `schemaVersion: "2.0.0"` (`PackV2`): `header`, `tiers`,
`sections` (every slot listed, empty ones with `findingIds: []`), `register`
(rows numbered in section order, then unplaced facts), `toConfirm` (register
rows with tier 2–4, at least one part, not verified). `employerApproval`
stays `false` under that key. `GET /api/packs/:id/md` renders 1.0.0 packs
with the existing layout and 2.0.0 packs as the eight-section document:

1. title `# <organisation> · organisation knowledge base`, header table, tier
   table ("How to read this");
2. sections 1–6, one `##` each, one `###` per slot with a Markdown table for
   table slots (Fact · Tier · Source · Date · Parts) and paragraphs otherwise;
   empty slots print `_Not yet researched._`;
3. `## 7. Fact register` table (# · Fact · Tier · Source · Date · Parts ·
   Verified); `## 8. Questions for the organisation`;
4. `## For the organisation to confirm`, `## Limitations`, then the JSON
   block as today.

`docs/research-pack-v2.schema.json` describes 2.0.0 beside the v1 schema.

## Step 2: structured rows and reference blocks

- `POST /api/organisations/:id/findings` and `PATCH /api/findings/:id` accept
  `fields`. For the ten table slots, keys are exactly those in `slotFields`;
  required values must be non-empty text and list columns must be string
  arrays. Unknown keys are rejected. `media.item.rights` is a `Rights` value.
  `case.measurement.origin` is an organisation source id or `invented and
  declared`; the latter permits no citations and consequently derives tier 4.
  When valid fields are supplied the server replaces `claim` with the
  deterministic row sentence. Stored older rows without fields remain
  readable and export their claim.
- `PATCH /api/organisations/:id` additionally accepts `factChecker`, `brand`,
  `mayUse` and `mustNotSay`; each block may be `null` to clear it. Every
  `{text, sourceId}` entry in the two lists must cite a source in the
  organisation whose effective tier is 1, otherwise the response is 422.
- `PATCH /api/roles/:id` additionally accepts `standard`, `ncsUrl`,
  `professionalBody` and `interview`; `null` clears each value. An interview's
  recording and transcript source ids, when present, must belong to the
  organisation, otherwise the response is 422. These role values, and the new
  organisation values, participate in the ready-content fingerprint.
- Research output accepts `fields`. The prompt lists every table slot's column
  keys, required keys and list keys. A generated row with invalid fields is
  retained with its original claim and slot but without `fields`; valid fields
  generate its claim as above.
- Pack 2.0.0 snapshots retain all reference blocks in their organisation and
  role objects. Markdown section 2 renders the standard, NCS profile and
  professional body; section 5 renders brand prose before its tables; section
  6 renders the interview and the two attributed lists. Table slots use their
  `slotFields` columns followed by Tier, Source and Date; legacy rows without
  fields put the claim in the first real column.

## Step 3: document and folder exports

- `GET /api/packs/:id/docx` returns a filled organisation knowledge-base DOCX.
  It retains the repository template's package parts, styles and final section
  properties. Both pack schemas are supported; 1.0.0 facts are placed in the
  fact register with an explicit legacy-schema note.
- `GET /api/packs/:id/zip` returns
  `<organisation>_<role>_knowledge-base_r<revision>.zip`: the DOCX, Markdown and
  JSON at its top level, plus all six numbered folders, their notes and the
  pack sources under their `exportName`. Name collisions gain `-2`, `-3` and
  so on. Captures and recorded statements are text files with provenance
  lines. Uploaded bytes are included only when their stored scanner verdict is
  clean; otherwise the folder contains a text explanation.
- `GET /api/packs/:id/confirm.md` returns the standalone “For the organisation
  to confirm” table for 2.0.0 packs. A 1.0.0 pack returns 404 because that
  schema has no `toConfirm` register.

## Step 5: folder-first workflow

- `GET /api/orgs/:orgId/sections?roleId=<id>` also returns `status`,
  `addedSinceExtraction` and `unreviewed` for every section. An unset status is
  `{stage: "gathering", by: "", at: ""}`. Organisation, brand and supplied
  status lives on the organisation; role, case and media status lives on the
  selected role.
- `PUT /api/orgs/:orgId/sections/:section/status` accepts `{stage, roleId?}`.
  Researchers may set `gathering` or `complete`. Only reviewers and
  administrators may set `reviewed`, and only with no unreviewed facts.
  `extracted` is worker-owned. Role id is required only for role-scoped
  sections. Every change is audited as `section.status`.
- `POST /api/organisations/:id/sources` accepts a `note`: Markdown `text`
  (at most 200,000 characters), `title`, required `extractedFrom`, and an
  optional folder and tier. Notes default to folder `01-organisation`, tier 2
  and reason `Team note; extracted from <extractedFrom>`. Their export name
  ends in `.md`; ZIP content starts with title, extraction provenance and date.
- Research creation accepts optional `crawl`. The worker crawls when it is
  `true`, never when it is `false`, and when absent retains the default of
  crawling only if `sourceIds` was not supplied. Notes are readable evidence.
- A completed or gaps run marks each requested section `extracted` in its
  organisation or role scope. A section already `reviewed` is not downgraded;
  the job instead records `Section <title> was already reviewed; new facts need
  review`.
- Readiness blocks a section which has at least one filled place but remains
  gathering: `The folder for <section> has facts but was never marked
  complete.`

## Step 6: designer's notes and "Sources read"

- `SectionNote` (`shared/types.ts`) is `{text, by, at}`; notes live on
  `Organisation.sectionNotes` (organisation, brand, supplied) and
  `Role.sectionNotes` (role, case, media), the same scoping as `sectionStatus`.
- `GET /api/orgs/:orgId/sections?roleId=<id>` returns `note: SectionNote |
  null` for every section.
- `PUT /api/orgs/:orgId/sections/:section/note` body `{text, roleId?}`.
  Researchers and above. `text` is trimmed; an empty string removes the note;
  longer than `sectionNoteMaxLength` (20,000 characters) is 422. Role id is
  required only for role-scoped sections, validated as for status. The server
  fills `by` (session name) and `at`. Response `{note: SectionNote | null}`.
  Audited as `section.note`. Note text (not `by`/`at`) participates in the
  ready-content fingerprint because it appears in the document.
- Pack 2.0.0 `sections[]` entries gain optional `note` (the note at snapshot
  time). Additive; `schemaVersion` stays `2.0.0` and
  `docs/research-pack-v2.schema.json` lists the property.
- Markdown (`/md`), for 2.0.0 packs: directly under each section heading, when
  a note exists, `### Designer's note`, the text verbatim, then `_<by> ·
  <date>_`. At the end of every section, `### Sources read` with a table
  `Source · Tier · What it gave us · Date read`: one row per pack source whose
  (derived) folder is the section's, ordered by `retrievedAt` then title.
  "What it gave us" lists the places filled by facts citing the source, as
  the slot label when the place is in this section and `<section title> ·
  <slot label>` otherwise, de-duplicated, or `No facts yet`. "Date read" is
  the `retrievedAt` date or `—`. With no sources the heading is followed by
  `_No sources filed in this folder._`
- DOCX: the same two blocks — a `Heading3` "Designer's note" with one
  paragraph per blank-line-separated block of the text, inserted straight
  after the section heading; a `Heading3` "Sources read" and table inserted
  before the next section heading (before "7. Fact register" for section 6).
- ZIP: a folder with a note also contains `00-designers-note.md` (title line,
  `by · date`, blank line, text).
- Client: the folder view shows the note at the top of the folder with
  "Write a note" / "Edit" for researchers and above (textarea with the
  character limit, Save, Cancel; saving empty text clears the note).
