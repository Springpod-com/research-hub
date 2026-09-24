import "dotenv/config";
import { Store } from "./store.js";
import { createApp } from "./app.js";
import { startWorker } from "./research.js";
import { allowedOrigins } from "./origins.js";
import { reportDeploy } from "./registry.js";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.DATABASE_URL ||
    !process.env.CLERK_SECRET_KEY ||
    !process.env.CLERK_PUBLISHABLE_KEY ||
    !allowedOrigins().length)
)
  throw new Error(
    "Production requires DATABASE_URL, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY and APP_ORIGINS (or Replit-provided REPLIT_DOMAINS).",
  );
if (
  process.env.DATABASE_URL &&
  process.env.DATABASE_CONFIRMED_STANDALONE !== "true"
)
  throw new Error(
    "Confirm this is a new standalone database with DATABASE_CONFIRMED_STANDALONE=true. Never use Organisation Intelligence credentials.",
  );
const store = await Store.open({
  url: process.env.DATABASE_URL,
  path: process.env.LOCAL_DATA_DIR || ".data/research",
});
await store.init();
const stopWorker = startWorker(store);
const app = createApp(store, { serveFrontend: production });
const server = app.listen(
  Number(process.env.PORT || 3001),
  production ? "0.0.0.0" : "127.0.0.1",
  () => {
    console.log(
      `Organisation Research is listening. Allowed origins: ${allowedOrigins().join(", ")}`,
    );
    // Every publish starts a fresh process, so this is the deploy heartbeat
    // the Springpod App Registry expects. It never blocks or stops the app.
    if (production) void reportDeploy(app);
  },
);
async function close() {
  stopWorker();
  server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
// A promise nobody awaited (a background capture, a timer callback) must not
// take every user's session down with it. Log it and carry on; genuine
// exceptions still stop the process so the platform restarts it cleanly.
process.on("unhandledRejection", (reason) =>
  console.error(
    "[server] unhandled rejection:",
    reason instanceof Error ? (reason.stack ?? reason.message) : reason,
  ),
);
