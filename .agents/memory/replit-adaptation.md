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
