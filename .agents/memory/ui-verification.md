---
name: Screenshotting signed-in pages without a Clerk session
description: Environment-specific way to visually verify authenticated Organisation Research pages in dev when no Clerk session is available.
---

The preview needs a Clerk session the agent cannot obtain. What works: stop only the API child process of the dev workflow (the tsx watcher and Vite must survive), run the fixture preview server on the API port with the background-task option and `DATABASE_URL` unset, screenshot the hash routes through Vite's proxy, then stop it and restart the workflow.
**Why:** killing the watcher takes Vite down with it, and detached shell processes die when the shell call returns.
**How to apply:** dialogs cannot be opened from the screenshot tool; drive those flows through the preview API and screenshot the resulting page state.

Dialog flows can be driven with the workspace's own Playwright package (import it by its path under node_modules/.pnpm; browser at /repl/tools/bin/chromium with --no-sandbox) against Vite's port. Two traps: the preview server's origin check rejects browser mutations from 127.0.0.1:<vite-port> unless APP_ORIGINS includes that origin when the preview server is started (node fetch without an Origin header is unaffected), and fixture record IDs are regenerated on every preview-server start, so look organisations up by name instead of hardcoding IDs.

## Real signed-in end-to-end run against the dev Clerk instance (works, verified 2026-09-16)

Create a throwaway user with Clerk's Backend API using a `+clerk_test@` email (any password, `skipPasswordChecks`), add it as an active member through the app's own `Store.transact` (dev `DATABASE_URL`), and drive Playwright at `https://$REPLIT_DEV_DOMAIN` — not 127.0.0.1, which is not an authorized party, so every API call would be 401. After the password Clerk asks a new device for an email code; test accounts accept `424242`. Delete the user, its membership, its audit rows and any created organisations afterwards (organisations have no delete endpoint).
**Why:** the fixture preview server cannot exercise Clerk cookie renewal, and the owner's own account must not be signed into.
**How to apply:** deleting the `__session` cookie proves nothing — ClerkJS rewrites it from its cached token every ~5 s; to test the 401 recovery path, fulfil one poll with a 401 via `page.route` and expect exactly one Clerk `/tokens` request and no error on screen.

## Screenshotting research-run states (verified 2026-09-16)

The fixture workspace has no research jobs, so run states cannot be screenshotted from the stock preview server; seed hand-built jobs in a throwaway copy of the preview server (they never run — the preview has no worker — which is what makes a live "researching" state observable). A tsx script kept under /tmp must use the `.mts` extension: with `.ts` it is compiled as CommonJS (no `"type": "module"` above /tmp) and top-level `await` fails.

## Real sign-in e2e, further traps (verified 2026-09-29)

In the Clerk sign-in card the first button named "Continue…" is "Continue with Google"; clicking it starts an OAuth redirect and disables the whole form. Submit with `button.cl-formButtonPrimary`, and wait for `input[name='password']:not([disabled])` because a disabled password input is rendered alongside the identifier step. Users created through Clerk's Backend API get a *verified* primary email, so an invitation-by-email flow can be tested without a mailbox; only the `__session`-cookie-only sign-in path needs the 424242 device code. A `.mts` script that imports `server/store.ts` directly and uses `Store.transact` is the way to seed and clean invitations/members in the dev database.
