import "dotenv/config";
import { Store } from "./store.js";
import { createApp } from "./app.js";
import { startWorker } from "./research.js";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.DATABASE_URL ||
    !process.env.CLERK_SECRET_KEY ||
    !process.env.CLERK_PUBLISHABLE_KEY ||
    !process.env.APP_ORIGINS)
)
  throw new Error(
    "Production requires DATABASE_URL, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY and APP_ORIGINS.",
  );
if (
  process.env.DATABASE_URL &&
  process.env.DATABASE_CONFIRMED_STANDALONE !== "true"
)
  throw new Error(
    "Confirm this is a new standalone database with DATABASE_CONFIRMED_STANDALONE=true. Never use Employer Intelligence credentials.",
  );
const store = await Store.open({
  url: process.env.DATABASE_URL,
  path: process.env.LOCAL_DATA_DIR || ".data/research",
});
await store.init();
const stopWorker = startWorker(store);
const server = createApp(store, { serveFrontend: production }).listen(
  Number(process.env.PORT || 3001),
  production ? "0.0.0.0" : "127.0.0.1",
  () => console.log("Organisation Research is listening."),
);
async function close() {
  stopWorker();
  server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
