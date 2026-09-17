---
name: Workspace document size and production capacity
description: Why the single-row workspace JSON must stay small, how the ETag poll is keyed, and what the production VM can actually carry.
---

Rule: nothing bulky (uploads, captures, binaries) goes inside the single `research_workspace` JSON row; bulk bytes belong in their own table (`research_files`) and the document must stay in the tens of kilobytes. `transact` only rewrites the row when the JSON changed, and the worker must read before it locks.
**Why:** two base64 uploads made the document 8.4 MB and the worker rewrote it every 1.5 s (unconditional UPDATE) — several MB of WAL per second on a 0.5 vCPU / 2 GB Reserved VM (e2-small) that also runs a ClamAV daemon (~1.2 GB RSS). Result in production: hanging `/api/health` for minutes, "terminating connection due to administrator command" from the managed Postgres, 99 MB relation for one row, users seeing the app "go down a lot".
**How to apply:** treat any new per-record payload as a candidate for its own table; measure `pg_column_size(data)` on the workspace row after a feature adds data; if uploads/scanning grow, the VM size (not the code) is the next constraint — ClamAV alone needs most of 2 GB.

ETag rule: the `/api/workspace` tag = process boot prefix + commit revision + role + userId. The user part is not optional: the browser cache is shared across sign-ins on the same browser, so a role-neutral tag would answer a member's revalidation with 304 and let the browser reuse an administrator's cached body. The revision is process-local by design (one process per environment); a restart changes the prefix.

Client polling: 12 s idle, 3 s while a run is active; overlapping reloads are resolved by "latest started wins" (a generation counter), otherwise an older response can put stale data back.

ClamAV on the 2 GB VM: clamd alone is ~990 MB RSS (measured, 1.4.3 with main+daily+bytecode). Anything that holds two signature sets at once hangs the whole VM for many minutes with no log output (health check included): freshclam's default TestDatabases (loads the new DB in-process, ~1 GB), clamd's default ConcurrentDatabaseReload, or starting the updater while clamd is still loading. The daemon script therefore sets TestDatabases no, ConcurrentDatabaseReload no, Checks 1, and starts freshclam only after clamd's socket exists plus a delay. Note freshclam still prints "Testing database:" unconditionally (cosmetic; the real load is skipped). Never `pkill -f` a pattern that appears in your own shell command line — it kills the shell.
