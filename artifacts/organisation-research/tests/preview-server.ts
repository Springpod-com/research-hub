// Explicit local-only synthetic demonstration. Never imported by the production entrypoint.
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sampleWorkspace } from "./fixtures.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Local preview cannot run in production.");
if (process.env.DATABASE_URL)
  throw new Error("Preview never connects to an external database.");
const store = await Store.open();
await store.init();
await store.transact((w) => Object.assign(w, sampleWorkspace()));
createApp(store, {
  testMember: {
    userId: "user_admin",
    name: "Sam Taylor",
    role: "admin",
    active: true,
  },
  preview: true,
}).listen(3001, "127.0.0.1", () =>
  console.log(
    "Fictional, temporary preview on 127.0.0.1:3001. No Clerk or live AI calls.",
  ),
);
