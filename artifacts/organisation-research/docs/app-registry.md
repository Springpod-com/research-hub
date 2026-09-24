# Springpod App Registry

How this app meets the "Springpod Build — connect to the App Registry MCP"
playbook, what has been done, and what still depends on the MCP.

## Keys

| Key | Where it lives | Used for |
| --- | --- | --- |
| `REGISTRY_API_KEY` | Replit Secrets of this project (never in code, git or chat) | Authenticates this app's deploy heartbeats and feedback (`X-Registry-Key`) |
| `SPRINGPOD_MCP_KEY` | The workspace's MCP-server integration (header `X-MCP-Key`) | Lets Replit Agent call the registry's MCP tools; not read by the app |

The app reads `process.env.REGISTRY_API_KEY` only inside `server/registry.ts`
and only to set the request header.

## Deploy heartbeat

- `server/registry.ts` builds the profile and posts it to
  `https://app-registry.springpod.com/api/heartbeat`.
- `server/index.ts` sends it once the server is listening, in production only.
  Every publish starts a fresh process, so every deploy sends a heartbeat. A
  missing key, a network failure or a rejected profile is logged with
  `[registry]` and never affects the app.
- `pnpm --filter @workspace/organisation-research run registry:heartbeat -- --dry-run [--tier=Yellow]`
  prints the exact profile; without `--dry-run` it sends it by hand.
- `tests/registry.test.ts` checks the field allow-list, the route table, that
  no secret or environment value is carried, and the failure behaviour.

### Contract, as confirmed against the registry's validation (2026-09-24)

A successful heartbeat answers `{ ok, snapshotId, appNameMismatch,
tierRegistered, tierDeclared, tierMismatch, tierEscalation }`; production
logs only the tier and route count.

- Required: `tier` (one of `Green`, `Yellow`, `Orange`, `Red`), `description`,
  `purpose`.
- Arrays: `apiRoutes`, `dependencies`, `integrations`, `dataFlows`,
  `keyDecisions` (we also send `techStack` as an array).
- Strings: `dataModel` (a summary), `governanceNotes`.
- Any key outside the allow-list is rejected with `400 unknown field not
  allowed`, so the profile carries nothing else.
- The MCP `get_heartbeat_schema` result and the contract `schemaVersion` from
  `registry://contract` have not been read yet (see below); once they are,
  record the version here and add it to the profile only if the schema lists
  it.

### What the profile contains

Allow-listed fields only: description, purpose, tech stack (with versions
from `package.json`), the live route table read from the Express app,
runtime dependencies with pinned versions, a data-model summary, key
decisions, integrations, data flows and governance notes. No source code,
secrets, environment values, database contents or user data.

## Security tier

`registeredTier` in `server/registry.ts` must equal the tier chosen when the
app was registered at `https://app-registry.springpod.com/register`. It is
**Red** (owner, 2026-09-24); the registry's first heartbeat reply confirmed
`tierRegistered: Red`, `tierDeclared: Red`, no mismatch (snapshot
`8ce3902b-5acd-456a-abf9-8b6514626b25`). If the tier were ever unset the
heartbeat would refuse to send rather than guess. When the MCP is reachable,
answer the five intake questions with `classify_project` and make sure it
agrees with Red; then `get_requirements` and `get_checks` for Red apply before
every publish. Red is the top tier, so its requirements are cumulative over
Green, Yellow and Orange.

Facts for the intake questions: internal staff tool behind Clerk sign-in
with workspace roles; stores material about partner organisations (public
pages, uploaded documents, statements) and the names and job titles of the
contacts who supply statements; no learner, candidate or payment data; no
Springpod data-warehouse access; models reached only through the Replit AI
Integrations proxy; hosted on a Replit Reserved VM with Replit-managed
PostgreSQL.

## MCP status

On 2026-09-24 the workspace MCP server "Springpod App Registry" was
configured but unreachable from Replit Agent (the platform reported "Failed
to reach MCP server" and exposed no tools). A direct request to
`/api/mcp` answered `{"error":"missing or invalid API key"}`, so the
`X-MCP-Key` header in the Replit integration is missing or wrong. This was
reported through `POST /api/feedback` (type `error`, severity `medium`,
area `mcp`; the registry returned id `9cc80e0e-498d-4efa-ac86-7d7a228dbfa6`).

The owner added the header on 2026-09-24, but the tools were still not
exposed to the agent in that session; if they remain absent, re-run **Test &
Save** on the integration, check the header value against the Getting
Started page, and start a fresh agent session so the tool list is refreshed.

To fix (once, workspace-wide, by a signed-in @springpod.com user):
Integrations → MCP Servers for Replit Agent → edit **Springpod App Registry**
→ URL `https://app-registry.springpod.com/api/mcp` → Advanced settings →
header `X-MCP-Key` = the `SPRINGPOD_MCP_KEY` value from the registry's
Getting Started page → Test & Save.

Pending until the MCP answers: `classify_project` (confirm the tier),
`get_requirements`, `guidance://topic/*`, `brand://tokens`,
`registry://contract` (record `schemaVersion` here), `get_checks` before the
next publish, and `dwh://fingerprint`. This app does not use the
data-warehouse, so the fingerprint is recorded for completeness only.

## Before every publish

1. `pnpm --filter @workspace/organisation-research run typecheck`, `test`
   and `audit` pass.
2. MCP reachable: run `get_checks` for the registered tier and make each
   check pass; compare `dwh://fingerprint` with the value recorded here.
3. Publish. The new process sends the heartbeat; confirm
   `[registry] deploy heartbeat sent` in the deployment logs, or send it by
   hand with `run registry:heartbeat`.
4. Anything unclear, contradictory or broken in the registry, its guidance or
   the MCP: report it with `report_feedback` (or `POST /api/feedback` with
   `type`, `severity`, `area`, `message`) before working around it.
