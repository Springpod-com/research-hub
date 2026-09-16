---
name: Screenshotting signed-in pages without a Clerk session
description: Environment-specific way to visually verify authenticated Organisation Research pages in dev when no Clerk session is available.
---

The preview needs a Clerk session the agent cannot obtain. What works: stop only the API child process of the dev workflow (the tsx watcher and Vite must survive), run the fixture preview server on the API port with the background-task option and `DATABASE_URL` unset, screenshot the hash routes through Vite's proxy, then stop it and restart the workflow.
**Why:** killing the watcher takes Vite down with it, and detached shell processes die when the shell call returns.
**How to apply:** dialogs cannot be opened from the screenshot tool; drive those flows through the preview API and screenshot the resulting page state.
