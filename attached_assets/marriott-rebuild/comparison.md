# Marriott · Executive Sous Chef: offline document vs platform rebuild

## Basis of comparison

- Offline document: `Springpod_Client_Knowledge_Base_Marriott_Executive-Sous-Chef__1790065931924.docx`.
- Platform snapshot: pack `e6c2d5d0-6d3e-44fa-b412-9f6a0f059c9b` (revision 3), exported on 22 September 2026.
- “Places” are mapped to the platform’s fixed place vocabulary. The offline document predates that structured vocabulary, so its filled counts are a manual, conservative mapping of substantive content, not machine fields.
- Offline per-section fact counts map its 27-row fact register by subject/source. Rows 8, 9, 26 and 27 are relevant both to their subject sections and to section 6 because they derive from supplied documents; those section counts therefore overlap. Platform per-section counts include placed facts only. The platform also has eight unplaced register facts.
- A place is not counted as filled merely because the offline document names a gap. For example, an unheld interview and an empty media folder remain empty.

## Side-by-side by section

| Section | Offline places | Offline facts by tier | Offline designer-style note or recommendation? | Platform places | Platform facts by tier | Platform designer’s note? |
|---|---:|---|---|---:|---|---|
| 1. The organisation | 7 / 7 | 11: T1 2, T2 6, T3 3, T4 0 | Yes — recommends Courtyard Sandy Park while clearly marking it for confirmation | 3 / 7 | 3: T1 0, T2 3, T3 0, T4 0 | Yes |
| 2. The role | 8 / 8 | 8: T1 0, T2 2, T3 4, T4 2 | Yes — warns that the exact title comes from non-Marriott material and recommends plain wording about competence | 4 / 8 | 4: T1 0, T2 1, T3 3, T4 0 | Yes |
| 3. Case material | 6 / 6 | 6: T1 0, T2 0, T3 6, T4 0 | Yes — explicitly says the interview is the highest-value missing evidence and separates sourced rules from inference | 5 / 6 | 6: T1 0, T2 0, T3 6, T4 0 | No |
| 4. Media | 0 / 1 | 0 | Yes — records that the folder is empty and recommends an interview and a clearable Marriott kitchen film | 0 / 1 | 0 | No |
| 5. Brand | 6 / 7 | 2: T1 2, T2 0, T3 0, T4 0 | Yes — gives practical cautions on logo provenance, type licensing, rights and page captures | 4 / 7 | 4: T1 4, T2 0, T3 0, T4 0 | No |
| 6. Supplied by the organisation | 2 / 4 | 4: T1 4, T2 0, T3 0, T4 0 | Yes — records the absent interview and client clearances, then sets provisional red lines | 1 / 4 | 1: T1 1, T2 0, T3 0, T4 0 | No |

### Headline numbers

- Offline register: **27 facts** — **T1 4, T2 8, T3 13, T4 2**.
- Platform register: **26 facts** — **T1 12, T2 5, T3 9, T4 0**.
- Platform placed facts: **18**; platform unplaced facts: **8**.
- Offline mapped places: **29 / 33**. Platform places: **17 / 33**.
- Both leave media at **0 / 1**. The offline document has prose recommendations in every section; the platform has explicit designer’s notes in sections 1 and 2, as requested.

The higher platform T1 count does not mean it has more independent client evidence. Multiple generated facts cite the same supplied style-guide evidence, including unplaced facts. Conversely, the offline register deliberately keeps only four selected brand rows at T1.

## Most telling differences

1. **The offline document synthesises more context; the platform keeps a smaller fact set.**  
   Offline example: “Marriott runs hotels, and mostly does not own them. It manages them for their owners, or lets other companies run them under its names, and it sets the standard for how they work.”  
   Platform example: “Marriott International, Inc. is a global hospitality manager and franchisor based in Bethesda, Maryland, that evolved from a 1927 root beer stand into a company with over 9,800 properties worldwide.”  
   The platform sentence is traceable, but its section leaves entity, sites, size and recent news unfilled. The offline prose covers those areas and labels uncertainty about the employing legal entity.

2. **The platform is more conservative about the exact role title, but loses useful explanation.**  
   Offline example: “Marriott’s own UK adverts in this folder do not use that exact title.” It then distinguishes Junior, Hotel and Senior Sous Chef adverts and says the Executive Sous Chef framing comes from an art’otel script.  
   Platform result: “The role as the organisation names it” is `_Not yet researched._` The designer’s note does preserve the title problem, while the platform places adjacent evidence under the standard, professional body, NCS profile and duties.

3. **The offline case section turns evidence into a working scenario; the platform retains atomic rules.**  
   Offline example: “The shift the Executive Chef is not there for. A morning that runs prep and ordering across two or three outlets, a handover into service…”  
   Platform example: “Hot food for service or display must be held at a temperature of 63°C or above.”  
   The platform’s six placed case facts are easier to audit individually. The offline version is much more useful as a narrative design brief, but explicitly admits that its day shape is not sourced from a Marriott kitchen.

4. **The two documents handle non-Marriott illustrative evidence differently.**  
   The offline register keeps two declared T4 rows, including “The six situations the activity is built from…” and says they are not Marriott facts. The platform correctly stores the art’otel script source at tier 4 with the supplied reason, but extraction produced no T4 finding from it.

5. **The platform separates confirmation work into an actual deliverable.**  
   `Marriott_confirm.md` contains 14 T2/T3 rows with source and learner-part columns ready for initials and date. The offline document explains the same intended process and has verification cells in its register, but there was no separate confirmation file beside the DOCX.

## What the platform export adds

- Every retained fact has structured citations with a source id and an evidence quotation in the pack data, rather than only a prose source reference.
- Source and finding tiers are derived consistently. The Marriott-supplied PDF derives tier 1 from `providedBy`; profession sources are tier 3; the different-hotel script is explicitly overridden to tier 4 with a reason.
- The export lists sources read under each section, including sources that yielded no retained fact.
- The ZIP preserves the six-folder structure and includes both designer’s notes.
- A standalone confirmation page is exported, in addition to Markdown, DOCX and ZIP.
- The UK SOC dataset match was available and a proposed primary match was recorded for the role.

## Limitations and errors encountered

### Inputs and uploads

- `logo.svg` was rejected with HTTP 422: “Use PDF, DOCX, TXT, Markdown, PNG or JPEG, up to 10 MB.” SVG is not an accepted upload type.
- `soux-chef.webp` was rejected with the same HTTP 422 response. WebP is not an accepted upload type.
- `2023peoplebrandrecruitmentmarketingplaybook.pdf` is 31,484,692 bytes (about 30 MB), over the 10 MB limit. It was deliberately not uploaded, split or altered.
- `marriottbepeoplebrandstyleguide.pdf` (9,464,575 bytes) was accepted as a Marriott-provided source and extracted. The dev setup did not record a clean scanner verdict, so the ZIP safely contains a short explanation instead of the original PDF bytes. No scanner was bypassed.
- The media folder remained gathering and empty.

### Extraction runs

All five runs used `gemini-3-flash-preview`, completed with status `gaps`, and retained evidence despite validation warnings.

| Folder | Duration | Facts retained from run | Model output count | Errors |
|---|---:|---:|---:|---:|
| 01 organisation | 24.4 s | 3 | 3 | 4 |
| 02 role | 30.4 s | 5 | 5 | 4 |
| 03 case material | 27.3 s | 6 | 6 | 2 |
| 05 brand | 24.3 s | 6 | 6 | 5 |
| 06 supplied | 30.4 s | 6 | 6 | 9 |

- Organisation: four generated facts were excluded because their quotation or evidence category could not be verified.
- Role: one `organisation.size` fact was left unplaced because it was outside the requested folder; three generated facts were excluded for quotation/evidence verification.
- Case: two generated facts were excluded for quotation/evidence verification.
- Brand: one `organisation.voice` fact was left unplaced; four generated facts were excluded for quotation/evidence verification.
- Supplied: five facts were left unplaced because their proposed places were outside the requested folder (`organisation.size`, `organisation.voice`, `brand.colour`, `brand.house-style`, `brand.logo`); four generated facts were excluded for quotation/evidence verification.

“Facts retained from run” includes facts deliberately left unplaced in the register. This is why it is higher than the placed fact count for role, brand and supplied.

### Empty platform places

- Organisation: entity, sites, size and recent news.
- Role: exact role title, job adverts, day in the role and vocabulary.
- Case: equipment and instruments.
- Media: media items.
- Brand: type, house style and screenshots.
- Supplied: interview, names/things that may be used, and things that must not be said.

### Header fidelity and product behaviour

- The platform has no separate sector field. “Hospitality” is retained in the organisation summary/record context, while the `division` field had to carry the offline document’s entity text because that is what the export renders in the Entity column.
- The offline “Compiled by” value is “Ollie Fisher, Springpod”. The rebuild was necessarily performed by the throwaway account whose required display name was “Springpod research”. The platform export nevertheless renders the raw Clerk user id in “Compiled by”, not the member display name. This is an export bug; no application code was changed to conceal it.
- The fact-checker text was carried across as “Not yet known — section 8, question 1”. The export appends an empty job-title separator.
- The platform snapshot dates reflect the actual rebuild date, 22 September 2026, rather than copying the offline document’s 17 September 2026 compilation date.

## Re-run after extraction changes (22 September 2026)

### Method

The re-run used the same Marriott organisation and role, and the same source ids in each numbered folder. Before extraction, all 26 existing non-rejected Marriott facts were rejected through `PATCH /api/findings/:id`; no fact rows were deleted through SQL. Five separate economy-tier runs were then made with the role id, one section and that folder’s exact source ids, with crawling disabled.

Re-run pack: `15e303ef-7b1c-44ea-a92e-242c71df800a`.

### Headline difference

| Measure | Original platform run | Re-run | Change |
|---|---:|---:|---:|
| Non-rejected facts | 26 | 17 | -9 |
| Tier 1 | 12 | 8 | -4 |
| Tier 2 | 5 | 6 | +1 |
| Tier 3 | 9 | 3 | -6 |
| Tier 4 | 0 | 0 | 0 |
| Places filled | 17 / 33 | 15 / 33 | -2 places |
| Unplaced facts | 8 | 0 | -8 |
| Cross-folder placements | 0 | 1 | +1 |

The changed extractor eliminated unplaced retained facts in this run and successfully placed one supplied-folder fact into Brand. It did not increase the total retained fact count in this sample: model output and quotation validation are still variable, and this re-run retained nine fewer facts overall.

The cross-folder placement was produced by the supplied-folder run:

> `brand.colour` — “Bonvoy Coral; #FF9662; seen Logos on high contrast background colors.”

### Places filled by section

| Section | Original run | Re-run | Change |
|---|---:|---:|---:|
| 1. The organisation | 3 / 7 | 3 / 7 | — |
| 2. The role | 4 / 8 | 3 / 8 | -1 |
| 3. Case material | 5 / 6 | 2 / 6 | -3 |
| 4. Media | 0 / 1 | 0 / 1 | — |
| 5. Brand | 4 / 7 | 5 / 7 | +1 |
| 6. Supplied by the organisation | 1 / 4 | 2 / 4 | +1 |

### Re-run extraction results and exclusions

All five final job states were `gaps` and used `gemini-3-flash-preview`.

| Folder | Duration | Facts retained | Cross-folder | Unplaced | Exclusions |
|---|---:|---:|---:|---:|---:|
| 01 organisation | 58.8 s | 3 | 0 | 0 | 6 |
| 02 role | 17.7 s | 4 | 0 | 0 | 5 |
| 03 case material | 38.6 s | 2 | 0 | 0 | 7 |
| 05 brand | 18.7 s | 5 | 0 | 0 | 1 |
| 06 supplied | 271.9 s including recovery | 3 | 1 | 0 | 5 |

For organisation, role, case, brand and the five supplied-folder exclusions, the recorded wording was:

> “A generated fact was excluded because its quotation or evidence category could not be verified.”

The supplied-folder job also recorded two non-exclusion messages:

> “An interrupted research run was recovered. Completed evidence has been retained.”

> “Placed 1 fact in other folders: Brand (1)”

The interruption happened after an initial pack request was made while the supplied job was still being recovered; the dev API became briefly unavailable and then recovered the research job automatically. The final pack was created only after every job had reached a terminal state. No application code or database rows were changed as a workaround.

### Export header and files

The compiled-by behaviour is fixed in this pack. The re-run Markdown header shows **“Springpod research”**, the workspace member name, rather than the raw Clerk user id seen in the original platform export.

Re-run exports:

- `Marriott_Executive-Sous-Chef_platform_rerun.md`
- `Marriott_Executive-Sous-Chef_platform_rerun.docx`
- `Marriott_confirm_rerun.md`