# Organisation Research

A standalone Springpod team workspace for collecting organisation and role evidence, reviewing findings, proposing activities, recording client questions, and exporting immutable research packs. Built with React, the Springpod design system, Express, Clerk and PostgreSQL. It has no Employer Intelligence service or database dependency.

**Start here for Replit:** [Handover prompt](docs/REPLIT-HANDOVER.md). Read [implementation status](docs/IMPLEMENTATION-STATUS.md) alongside the [PRD](docs/PRD.md). This is an implemented MVP with remaining live integrations and PRD gaps explicitly recorded, not a claim of production sign-off.

## Run the fictional demonstration

Requires Node 22.12+ and npm. From the project root:

```sh
npm ci
npm run demo
```

Open the Vite address printed in the terminal (normally http://localhost:5173). The separate demo entry point seeds fictional organisations into a temporary in-memory database. It does not use Clerk, call AI providers, or persist changes after restart. It must never be deployed. Production rejects preview authentication options.

Try Northstar Logistics → Evidence → Inspect & review → Accept for drafting; Roles → accept the activity; Research packs → Create snapshot → Ready for storyboard drafting. Download Markdown and JSON. Open client questions remain visible.

## Run the real workspace locally

1. Copy `.env.example` to `.env` and configure the new Clerk application and approved origins. Never put secrets in a `VITE_` variable.
2. Set `BOOTSTRAP_ADMIN_IDS` to the stable Clerk user ID of the initial administrator.
3. Run `npm run dev`. The browser uses port 5173; the private API uses 3001.
4. Sign in, then use Team & connections to add approved Clerk user IDs and application roles. Clerk identity alone does not grant access.

Without `DATABASE_URL`, development uses a local PGlite database in `.data/research`. Production requires a new PostgreSQL database plus `DATABASE_CONFIRMED_STANDALONE=true`. The application initialises its own two tables and immutability trigger. Never point it at Employer Intelligence or a shared production database.

## Replit configuration

Import this directory as a new project. `.replit` supplies development and VM deployment commands. Build installs dependencies, builds the frontend and runs the design audit. Production serves the frontend and API together on port 5173, mapped to external port 80. An always-running deployment is required for the embedded research worker.

Configure Replit Secrets:

| Secret | Purpose |
| --- | --- |
| `DATABASE_URL` | New standalone PostgreSQL database |
| `DATABASE_CONFIRMED_STANDALONE` | `true`, after checking database ownership |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk keys (this project uses Replit-managed Clerk; the Frontend API is proxied under `/api/__clerk` in production, set `CLERK_PROXY_DISABLED=true` for a self-owned Clerk domain) |
| `APP_ORIGINS` | Optional. Comma-separated exact allowed HTTPS origins, without trailing slashes; defaults to the Replit deployment/development domains |
| `BOOTSTRAP_ADMIN_EMAILS` | Verified primary email address(es) of the initial administrator(s); `BOOTSTRAP_ADMIN_IDS` (Clerk user IDs) also works. Remove after provisioning |
| `AI_INTEGRATIONS_*` | Replit AI-integration proxy keys/base URLs for Gemini, Anthropic and OpenAI (managed by Replit) |
| `ECONOMY_MODEL`, `POWER_MODEL`, `MAX_CLAUDE_MODEL`, `MAX_OPENAI_MODEL` | Exact API model IDs, chosen by the owner |
| `UPLOAD_SCAN_COMMAND` | Production only: `scripts/clamav/scan-upload.sh` (in-project ClamAV; `CLAMAV_SIDECAR`, `CLAMAV_RUN_DIR`, `CLAMAV_DB_DIR` tune the sidecar) |
| `OCCUPATION_DATA_DIR` | Optional. Directory of the bundled occupational datasets (defaults to `data/occupations`) |

Model IDs deliberately have no guessed defaults. Choose exact IDs available to the provider account. The intended Max pairing is Fable + GPT-6 if available through those APIs. Verify both with a small live run before using real material. Models beginning `gemini` use Google, `claude` use Anthropic, and the remaining configured model uses OpenAI Responses.

### Clerk SSO

Create a Clerk application for this workspace. Configure the intended enterprise SSO connection and approved organisational domains in Clerk; restrict account creation to approved team members. Configure development and production domains/redirects in Clerk. Add the first administrator's verified email (or Clerk user ID) to the bootstrap setting, sign in, then provision team membership inside this app. The roles are researcher, reviewer and admin. Researchers can review findings; only reviewers/admins can mark packs ready; only admins can manage membership.

**SSO is not established merely by adding keys.** Test your actual identity-provider connection, unapproved accounts, revoked members, file downloads and exports in the deployed environment. Do not replace Clerk with custom authentication.

### File uploads

PDF, DOCX, TXT, Markdown (.md), PNG and JPEG up to 10 MB are supported. PDF page markers and document text are retained where extractable. There is no OCR. Production refuses uploads until `UPLOAD_SCAN_COMMAND` is configured. On Replit, provision a compatible scanner and its definitions/service, or implement and test a supported scanning adapter; do not disable the check. Images can be inspected with context and permissions; automated visual analysis is not implemented.

## Research behaviour

A run captures the official homepage plus up to three linked about/careers/team/service pages, combines them with up to 16 relevant recorded sources, and runs the configured model(s). Add other public pages with Capture URL, or upload/record source material. This is bounded retrieval, not a search-engine integration. Sources requiring sign-in are not accessed.

Max makes two independent analyses of the same captured source set. Exact duplicate findings merge model lineage. Other results remain available for human review; there is no semantic consensus or automated conflict resolution. Failed sources/models are visible and successful results survive partial failures. Source material is treated as untrusted evidence in the prompt. Factual findings require exact stored quotations, but reviewers must still verify that a passage actually supports the claim.

### Occupational reference data

Two official datasets are bundled as versioned JSON in `data/occupations/` and loaded in memory:

| Dataset | Role | Publisher and licence | Refresh |
| --- | --- | --- | --- |
| UK SOC 2020 (Volume 1 descriptions and Volume 2 coding index) | Primary classification, UK | Office for National Statistics — Open Government Licence v3.0 | `npm run occupations:import` |
| O*NET database (occupations, tasks, work activities, skills, knowledge, work context, reported titles) | Supplementary, US | USDOL/ETA via the National Center for O*NET Development — CC BY 4.0 | `npm run occupations:import` (`ONET_VERSION`, default `31_0`) |

"Find in official datasets" on a role profile runs deterministic keyword matching (weighted title/index-title/description/task retrieval) over both datasets and shows the matched terms for each candidate; there is no model and no unexplained confidence score. The researcher picks which dataset statements to keep as occupational context and records the match as *proposed* with its scheme, code, dataset version, source URL, jurisdiction, retrieval date and rationale (`basis: "dataset-search"`). The server takes the title, dataset version, source URL, jurisdiction and retrieval date from the bundled entry itself (client-supplied values are ignored), accepts only statements that appear in that entry, and always stores the match as proposed; a team member confirms it after checking it against the role ("Confirm match"). UK SOC and O*NET codes are stored separately; no equivalence is assumed, O*NET is labelled as US data, and manual recording remains available. The import script records the exact source URLs and retrieval date in each dataset file — keep the attribution when redistributing.

### Review state and source refresh

Each role profile carries a review state: any member can send it for review or return it to draft; only reviewers and administrators can mark it *ready*, and only when the readiness checks pass. A content fingerprint is stored at that point, so any later change to the role, organisation, findings, activities or questions returns the profile to draft. Ready snapshots can only be created from a profile that is currently ready; drafts can be created at any time.

Captured web pages can be refreshed. The earlier capture is never modified (existing quotations keep referring to it); a new capture is recorded with `supersedes`/`supersededBy` links and a stored sentence-level summary of what was added and removed (`captureDiff`). Findings citing any earlier capture of the page whose exact quotation newly disappears are flagged "Source changed — re-review" and block readiness until they are reviewed again; their version is bumped so a review opened before the refresh cannot be saved over the change. A refresh that finds no text change leaves a ready role profile ready.

## Export contract

Pack revision and schema version are separate. `schemaVersion: 1.0.0` is described by [research-pack.schema.json](docs/research-pack.schema.json); TypeScript shapes are in `shared/types.ts`. IDs are stable UUIDs. JSON and Markdown derive from the exact same saved snapshot. Markdown includes complete JSON metadata to preserve parity. Uploaded binary files are not embedded in packs; sources retain metadata and captured text. Keep the original assets available separately.

A ready pack includes accepted findings and activities; blocking questions must be answered and pending reviews resolved. Non-blocking questions travel with the pack. Employer approval is always false. Database triggers reject snapshot updates/deletes. Later edits require a new revision. Retention/erasure policy and privileged operational deletion remain deployment decisions.

## Verification

```sh
npm test
npm run typecheck
npx springpod-audit src
npm run build
```

Tests use a disposable database and mocked AI responses; they do not consume provider credits. See the implementation-status document for the exact coverage and unverified areas. The main stylesheet contains only the required Springpod import. Package components, icons and toasts are imported directly; no local design-system copies are scaffolded.
