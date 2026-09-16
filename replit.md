# Organisation Research

Springpod's internal organisation and role research workspace: researchers collect employer evidence, run tiered AI research, review findings, record client questions, match roles to official occupational data, and export immutable research packs (Markdown + JSON) for storyboard drafting. Access is restricted to approved team members via Clerk SSO plus an in-app membership list.

## Run & Operate

- `pnpm --filter @workspace/organisation-research run dev` — Vite on the workflow `PORT`, private Express API on 127.0.0.1:3001 (proxied under `/api`)
- `pnpm --filter @workspace/organisation-research run test` — Vitest (disposable PGlite database, mocked AI responses)
- `pnpm --filter @workspace/organisation-research run typecheck` — `tsc --noEmit`
- `pnpm --filter @workspace/organisation-research run audit` — `springpod-audit src`; must exit 0 (also runs inside the production build)
- `pnpm --filter @workspace/organisation-research run build:production` — typecheck + `vite build` + design audit (the deployment build command)
- `pnpm --filter @workspace/organisation-research run start` — production: one Express process serves `dist`, `/api` and the embedded research worker on `PORT`
- `pnpm --filter @workspace/organisation-research run demo` — fictional in-memory preview only; never deploy it
- Artifact-owned docs: `artifacts/organisation-research/docs/` (`REPLIT-HANDOVER.md`, `PRD.md`, `IMPLEMENTATION-STATUS.md`, `research-pack.schema.json`) and `artifacts/organisation-research/README.md`

### Environment

Runtime-managed: `DATABASE_URL` (the project's own Replit PostgreSQL; verified empty and dedicated before use). Shared env var: `DATABASE_CONFIRMED_STANDALONE=true`.

Secrets/values still owned by the workspace owner (see README table): `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `APP_ORIGINS`, `BOOTSTRAP_ADMIN_IDS`, provider keys with exact model IDs (`ECONOMY_MODEL`, `POWER_MODEL`, `MAX_CLAUDE_MODEL`, `MAX_OPENAI_MODEL`), `UPLOAD_SCAN_COMMAND`. Model IDs are never guessed or defaulted.

## Stack

- pnpm workspace; the app lives in `artifacts/organisation-research` (`@workspace/organisation-research`)
- Frontend: React 19 + Vite 7 + Tailwind 4 + `@springpod/design-system` (single import in `src/index.css`)
- Backend: Express 5, `@clerk/express`, zod 4, multer, helmet, express-rate-limit
- Data: `pg` against PostgreSQL in Replit/production; PGlite in `.data/research` only when `DATABASE_URL` is absent. Two tables (`research_workspace`, `research_packs`) plus an immutability trigger, created by the app itself
- Tests: Vitest + supertest

## Architecture decisions

- The supplied application was copied verbatim; only `package.json` (pnpm workspace name, exact lockfile versions) and `vite.config.ts` (Replit `PORT`, `allowedHosts`) were adapted. Do not regenerate the frontend.
- Dev keeps the API on a fixed private port (3001) because the workflow's `PORT` belongs to Vite; production runs a single process on `PORT` serving frontend + API from one origin.
- Deployment target is Reserved VM (`deploymentTarget = "vm"` in `.replit`) because the research worker is embedded in the web process and must stay running.
- Template `api-server` and `lib/*` packages were removed: the app owns `/api` itself and the shared OpenAPI/Drizzle libs were unused.
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
