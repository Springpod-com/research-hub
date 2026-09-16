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
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | The new application's Clerk keys |
| `APP_ORIGINS` | Comma-separated exact allowed HTTPS origins, without trailing slashes; include the development origin if used |
| `BOOTSTRAP_ADMIN_IDS` | Initial administrator Clerk user IDs; remove after provisioning |
| `GOOGLE_API_KEY`, `ECONOMY_MODEL` | Economy provider credentials and exact API model ID |
| `ANTHROPIC_API_KEY`, `POWER_MODEL` | Power provider credentials and exact API model ID |
| `MAX_CLAUDE_MODEL`, `MAX_OPENAI_MODEL`, `OPENAI_API_KEY` | Dual analysis; Anthropic key is also required |
| `UPLOAD_SCAN_COMMAND` | Absolute path to a working clamdscan-compatible scanner accepting standard input |

Model IDs deliberately have no guessed defaults. Choose exact IDs available to the provider account. The intended Max pairing is Fable + GPT-6 if available through those APIs. Verify both with a small live run before using real material. Models beginning `gemini` use Google, `claude` use Anthropic, and the remaining configured model uses OpenAI Responses.

### Clerk SSO

Create a Clerk application for this workspace. Configure the intended enterprise SSO connection and approved organisational domains in Clerk; restrict account creation to approved team members. Configure development and production domains/redirects in Clerk. Add the first administrator's Clerk user ID to the bootstrap setting, sign in, then provision team membership inside this app. The roles are researcher, reviewer and admin. Researchers can review findings; only reviewers/admins can mark packs ready; only admins can manage membership.

**SSO is not established merely by adding keys.** Test your actual identity-provider connection, unapproved accounts, revoked members, file downloads and exports in the deployed environment. Do not replace Clerk with custom authentication.

### File uploads

PDF, DOCX, TXT, PNG and JPEG up to 10 MB are supported. PDF page markers and document text are retained where extractable. There is no OCR. Production refuses uploads until `UPLOAD_SCAN_COMMAND` is configured. On Replit, provision a compatible scanner and its definitions/service, or implement and test a supported scanning adapter; do not disable the check. Images can be inspected with context and permissions; automated visual analysis is not implemented.

## Research behaviour

A run captures the official homepage plus up to three linked about/careers/team/service pages, combines them with up to 16 relevant recorded sources, and runs the configured model(s). Add other public pages with Capture URL, or upload/record source material. This is bounded retrieval, not a search-engine integration. Sources requiring sign-in are not accessed.

Max makes two independent analyses of the same captured source set. Exact duplicate findings merge model lineage. Other results remain available for human review; there is no semantic consensus or automated conflict resolution. Failed sources/models are visible and successful results survive partial failures. Source material is treated as untrusted evidence in the prompt. Factual findings require exact stored quotations, but reviewers must still verify that a passage actually supports the claim.

Occupation matching is assisted by links to official SOC/O*NET sources and structured manual records. Activities, skills, knowledge and work context retain the scheme/version/source URL. Automatic dataset search/retrieval is a recorded follow-up, not an implemented integration.

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
