# Organisation Research

Springpod's internal organisation and role research workspace: researchers collect employer evidence, run tiered AI research, review findings, record client questions, match roles to official occupational data, and export immutable research packs (Markdown + JSON) for storyboard drafting. Access is restricted to approved team members via Clerk SSO plus an in-app membership list: administrators add people by work email (Team & settings → Add team member); if that address has already signed in the member is created at once, otherwise an invitation is stored in the workspace document and redeemed on the person's first request (matched against the verified primary email of their Clerk account, like `BOOTSTRAP_ADMIN_EMAILS`).

## Run & Operate

- `pnpm --filter @workspace/organisation-research run dev` — Vite on the workflow `PORT`, private Express API on 127.0.0.1:3001 (proxied under `/api`)
- `pnpm --filter @workspace/organisation-research run test` — Vitest (disposable PGlite database, mocked AI responses)
- `pnpm --filter @workspace/organisation-research run typecheck` — `tsc --noEmit`
- `pnpm --filter @workspace/organisation-research run audit` — `springpod-audit src`; must exit 0 (also runs inside the production build)
- `pnpm --filter @workspace/organisation-research run build:production` — typecheck + `vite build` + design audit (the deployment build command)
- `pnpm --filter @workspace/organisation-research run start` — production: one Express process serves `dist`, `/api` and the embedded research worker on `PORT`
- `pnpm --filter @workspace/organisation-research run demo` — fictional in-memory preview only; never deploy it
- `pnpm --filter @workspace/organisation-research run registry:heartbeat -- --dry-run` — prints the Springpod App Registry profile; without `--dry-run` sends it (production sends automatically on start-up; `get_checks` must pass first when the MCP is reachable)
- `pnpm --filter @workspace/organisation-research run occupations:import` — refreshes the bundled occupational datasets (`data/occupations/*.json`) from ONS SOC 2020 (OGL v3) and O*NET (CC BY 4.0); set `ONET_VERSION` / `OCC_CACHE_DIR` as needed, commit the JSON, re-run tests
- `pnpm --filter @workspace/organisation-research run scanner` — starts the ClamAV daemon used by the upload scanner (production sidecar; needs ~1.3 GiB RAM for signatures)
- Artifact-owned docs: `artifacts/organisation-research/docs/` (`REPLIT-HANDOVER.md`, `PRD.md`, `IMPLEMENTATION-STATUS.md`, `research-pack.schema.json`, `app-registry.md`) and `artifacts/organisation-research/README.md`

### Environment

Runtime-managed: `DATABASE_URL` (the project's own Replit PostgreSQL; verified empty and dedicated before use). Shared env var: `DATABASE_CONFIRMED_STANDALONE=true`.

Owner-provided values (see README table): Replit-managed Clerk keys (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), `BOOTSTRAP_ADMIN_EMAILS` (verified primary email of the first administrator; `BOOTSTRAP_ADMIN_IDS` still works), Replit AI-integration proxy secrets, the exact research model ID (`RESEARCH_MODEL`, never guessed or defaulted; `POWER_MODEL` is still read as a fallback until a deployment sets it. One model, one analysis per run, prompt kept in code: plan P1.4, 28 Oct 2026), production-only `UPLOAD_SCAN_COMMAND=scripts/clamav/scan-upload.sh`, `REGISTRY_API_KEY` (Springpod App Registry; heartbeat on every production start, see `artifacts/organisation-research/docs/app-registry.md`). Optional: `APP_ORIGINS` (defaults to `REPLIT_DOMAINS`/dev domain), `CLERK_PROXY_DISABLED=true` for a self-owned Clerk domain, `CLAMAV_SIDECAR`, `CLAMAV_RUN_DIR`, `CLAMAV_DB_DIR`, `OCCUPATION_DATA_DIR`.

## Stack

- pnpm workspace; the app lives in `artifacts/organisation-research` (`@workspace/organisation-research`)
- Frontend: React 19 + Vite 7 + Tailwind 4 + `@springpod/design-system` (single import in `src/index.css`)
- Backend: Express 5, `@clerk/express`, zod 4, multer, helmet, express-rate-limit
- Data: `pg` against PostgreSQL in Replit/production; PGlite in `.data/research` only when `DATABASE_URL` is absent. Three tables (`research_workspace` — one JSON document, `research_packs`, `research_files` — uploaded bytes, one row per source) plus an immutability trigger, created by the app itself; a start-up migration moves any legacy base64 `blob` fields out of the document. Keep bulk data out of the workspace document (see `.agents/memory/workspace-document-load.md`)
- Tests: Vitest + supertest

## Architecture decisions

- The supplied application was copied verbatim; only `package.json` (pnpm workspace name, exact lockfile versions) and `vite.config.ts` (Replit `PORT`, `allowedHosts`) were adapted. Do not regenerate the frontend.
- Dev keeps the API on a fixed private port (3001) because the workflow's `PORT` belongs to Vite; production runs a single process on `PORT` serving frontend + API from one origin.
- Deployment target is Reserved VM (`deploymentTarget = "vm"` in `.replit`) because the research worker is embedded in the web process and must stay running.
- Template `api-server` and `lib/*` packages were removed: the app owns `/api` itself and the shared OpenAPI/Drizzle libs were unused.
- The template `mockup-sandbox` artifact and the `@workspace/scripts` package (only a hello script) were removed on 28 Oct 2026 (plan P1.1); `scripts/post-merge.sh` stays because `.replit` runs it.
- Occupational reference data is bundled, versioned JSON (UK SOC 2020 primary, O*NET supplementary) loaded in memory by `server/occupations.ts`; matching is deterministic keyword retrieval with the matched terms as rationale. No live API, no model, no DB schema for it.
- Approval is simplified: evidence-backed facts are registered by default and
  may only be excluded or restored; folders move automatically from gathering
  to extracted and can carry an optional reviewer tick. Pack creation has one
  immutable schema-2 path, blocked only by an active extraction; readiness is
  retained as an advisory Open items list.
- Retired on 28 Oct 2026 (plan P1.3, data kept): role review states and the ready fingerprint, activity candidates (packs carry an empty `activities` list), and source refresh with its capture diff. To re-read a page, capture it again as a new source.
- Forms trimmed (plan P1.6, 28 Oct 2026; stored values kept): organisations keep name, website, country, summary and the may-use and must-not-say lines (plain text; Studio reads them as text lines, so packs export them as strings); roles keep title, location, seniority, responsibilities and boundaries; material asks only whether it came from the organisation (that sets `client-confirmed`, so tier 1). Brand and media are not researched here (`notResearchedSections`): they are set in Studio.
- Quotations are flagged, not enforced (plan P1.2): a citation whose quote is not in its source is kept with `unmatched: true`, shown with a warning and named in the pack's limitations.
- Four dependencies are pinned one patch behind the supplied lockfile because the workspace enforces a 24-hour minimum package age: `@clerk/express` 2.1.67, `@clerk/react` 6.15.2, `@types/node` 22.20.2, `prettier` 3.9.6. Bump back once the versions are older than a day.

## Product rules (from the handover brief)

- Keep Clerk + organisational SSO; all access checks are server-side; never introduce mock auth in production.
- Never connect to Employer Intelligence or its database.
- Preserve stable IDs, evidence references, schema versions and immutable pack snapshots. Readiness is not employer approval.
- Keep employer facts, occupational context, proposals and questions distinct. Occupational data must keep source identity, dataset version, code, rationale and jurisdiction; never imply O*NET describes the employer or equals UK SOC.
- Max tier = two models over the same captured sources; describe it truthfully.
- Do not bypass the production upload-scanner requirement.

## Gotchas

- Run `pnpm --filter @workspace/organisation-research run audit` before shipping UI changes; read `node_modules/@springpod/design-system/AGENTS.md` first.
- `pnpm run audit` inside the package is the design audit script, not `pnpm audit` (the security command).
- `server/index.ts` refuses to start when `DATABASE_URL` is set without `DATABASE_CONFIRMED_STANDALONE=true`.
- Production refuses to start without `CLERK_*`, `APP_ORIGINS` and `DATABASE_URL`; production also refuses uploads until `UPLOAD_SCAN_COMMAND` exists.

## Pointers

- See the `pnpm-workspace` skill for workspace structure and TypeScript setup
