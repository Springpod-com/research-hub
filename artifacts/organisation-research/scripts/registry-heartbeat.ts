/**
 * Send (or print) the Springpod App Registry deploy heartbeat by hand.
 *
 *   pnpm --filter @workspace/organisation-research run registry:heartbeat -- --dry-run [--tier=Yellow]
 *     prints the exact profile that would be sent, without a key or network.
 *   pnpm --filter @workspace/organisation-research run registry:heartbeat
 *     posts it with REGISTRY_API_KEY from the environment.
 *
 * Production sends the same profile automatically on start-up
 * (server/index.ts); use this before a publish or to check the content.
 */
import "dotenv/config";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import {
  buildHeartbeat,
  registeredTier,
  registryTiers,
  sendHeartbeat,
  type RegistryTier,
} from "../server/registry.js";

const dryRun = process.argv.includes("--dry-run");
// `--tier=<Green|Yellow|Orange|Red>` previews the profile before the tier is
// confirmed in code; a real send always uses the registered tier.
const previewTier = process.argv
  .find((arg) => arg.startsWith("--tier="))
  ?.slice("--tier=".length);
if (previewTier && !dryRun)
  throw new Error("--tier is only for --dry-run; set registeredTier in server/registry.ts to send.");
if (previewTier && !(registryTiers as string[]).includes(previewTier))
  throw new Error(`--tier must be one of ${registryTiers.join(", ")}.`);
// An in-memory store is enough: only the route table is read from the app.
const store = await Store.open();
try {
  const heartbeat = buildHeartbeat(
    createApp(store),
    (previewTier as RegistryTier | undefined) ?? registeredTier,
  );
  if (dryRun) {
    console.log(JSON.stringify(heartbeat, null, 2));
  } else {
    const reply = await sendHeartbeat(heartbeat);
    console.log(
      `[registry] heartbeat accepted (${heartbeat.tier}, ${heartbeat.apiRoutes.length} routes): ${JSON.stringify(reply)}`,
    );
  }
} finally {
  await store.close();
}
