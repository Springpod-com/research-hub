---
name: Delegation quirks in this workspace
description: How subagent waits and explorer reports behave here; read before orchestrating multi-agent builds.
---

- A `waitForJob` timeout inside CodeExecution aborts the whole block; wrapping it in try/catch or a retry loop does not help. Issue one `waitForJob` (≤ 600 s) per block and call again if it times out.
  **Why:** two long builds (2026-09-17) lost their loop iterations this way; the jobs themselves kept running and were collected on the next call.
- Explorer reports can name endpoints that do not exist (an explorer described a findings bulk-review route that was never there). Before briefing builders on an "existing" route, `grep` for it.
  **How to apply:** put the verified route paths in the shared contract doc (docs/knowledge-base-api.md pattern) so parallel server/client agents code against the same names.
- Parallel builders on server/** and src/** worked well when shared types were written first by the main agent and each builder was told exactly which paths it owns; a third agent for browser verification found the integration bugs.
- A subagent can end "without delivering a result" after making edits; check `git diff` and grep for the expected strings before assuming the work is lost.
- Subagent names do not survive a memory compaction/session boundary (`sendFollowup` reports the name expired). Re-create a fresh builder/verifier and point it at the memory recipe (ui-verification.md) rather than relying on a summarised name.
