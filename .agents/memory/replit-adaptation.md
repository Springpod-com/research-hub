---
name: Replit adaptation of the supplied app
description: Non-obvious constraints met while porting the supplied Organisation Research app into this pnpm workspace (install rules, ports, DB guard, deployment target)
---

# Porting constraints that are easy to trip over

- **Minimum release age blocks fresh packages.** `pnpm-workspace.yaml` enforces a 24-hour minimum package age. Any dependency version published in the last day fails install with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Pin one version back instead of adding to `minimumReleaseAgeExclude`.
  **Why:** the exclusion list is meant only for trusted publishers in emergencies; a patch bump is lower risk than weakening the supply-chain guard.
  **How to apply:** when bumping deps, check `npm view <pkg> time` against the cutoff before editing package.json.

- **The root `preinstall` forbids npm and deletes `package-lock.json`.** The supplied `npm ci` lockfile flow cannot be honoured literally; exact lockfile versions were pinned in `package.json` instead.

- **Dev ports.** The workflow `PORT` belongs to Vite; the API must stay on 3001 (`PORT=3001` prefix inside the `dev` script). Production is one Express process on `PORT`.

- **Database guard.** The app refuses any `DATABASE_URL` unless `DATABASE_CONFIRMED_STANDALONE=true`. The project's own Replit PostgreSQL (`heliumdb`) was verified empty before the flag was set in the shared env. Never point it at Employer Intelligence.

- **Deployment target.** `.replit` `deploymentTarget` was switched from `autoscale` to `vm`: the research worker runs inside the web process and needs an always-on instance. This is a project-level setting, not artifact service config.

- **`pkill -f "server/index.ts"` kills the dev workflow too** (tsx watch matches). Smoke-test production on another port and stop it with `pkill -f "PORT=<port>"` or the specific pid.

- **Detached background processes die with the shell call.** `( cmd & )` inside a normal shell command is killed when the call returns (the ClamAV signature download died silently mid-way). Start daemons with the background-task option instead.

- **Replit AI Integrations proxy quirks (verified live).** Gemini `generateContent` needs `role: "user"` in `contents` and the base URL has no `/v1beta` segment; Anthropic uses `<base>/v1/messages`; OpenAI uses `<base>/responses`. `claude-opus-5` returns thinking blocks (the app filters `type === "text"`). Only the documented model list works; tier mapping lives in `ECONOMY_MODEL`/`POWER_MODEL`/`MAX_*_MODEL` env vars (overridable per slot from the app's research settings). None of the three proxies exposes a list-models endpoint (all return 405), so the in-app model picker is a dated catalogue plus free text, and every saved model is proven with a 64-token live probe first — keep that probe when touching model settings.

- **Upload scanner = ClamAV sidecar.** `scripts/start-production.sh` starts `clamd` (≈1 GB RSS with signatures loaded) before the app; signatures are downloaded from database.clamav.net into `.data/clamav/db` on first start (slow, rate-limited CDN). The Reserved VM therefore needs ≥ 2 GiB RAM (4 GiB comfortable). `UPLOAD_SCAN_COMMAND` is set only in the production env; dev uploads are unscanned unless `pnpm run scanner` is running and the var is set.

- **Managed Clerk in this app.** The `/api/__clerk` proxy is production-only and the frontend learns the proxy path from `/api/config` (fallback for `VITE_CLERK_PROXY_URL`). Dev and prod Clerk instances have different user IDs, so the bootstrap admin is matched by verified primary email (`BOOTSTRAP_ADMIN_EMAILS`) rather than only by ID.

- **"It logs me out" reports are usually failed polls, not Clerk.** Auth stays cookie-based (the clerk-auth skill forbids bearer tokens on web). Decision: a 401 triggers one coalesced `getToken({ skipCache: true })` (renews Clerk's cookie) and a single retry; failed background polls keep the loaded workspace with a notice; only a 403, or a 401 that survives renewal plus a further poll, removes it. **Why:** the app used to replace the whole UI with "Sign in to your workspace" on any transient failure. Check the published VM's health too: on 2026-09-16 it stopped answering (`/api/health` hung, ClamAV self-check log lines stopped) while the dashboard still said deployed.

- **Deployments sit behind one proxy hop.** Express apps must `set("trust proxy", 1)` or `req.ip` is the edge address and every user shares one rate-limit bucket (express-rate-limit logs ERR_ERL_UNEXPECTED_X_FORWARDED_FOR in deployment logs). Verify live by reading `ratelimit-remaining` on a first request: anything below limit-1 means the bucket is shared.
