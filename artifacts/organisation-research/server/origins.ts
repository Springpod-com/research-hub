/**
 * Browser origins allowed to make state-changing API requests and accepted by
 * Clerk as authorized parties.
 *
 * APP_ORIGINS (comma-separated) always wins. Without it, the origins are
 * derived from the hostnames Replit assigns to this deployment or workspace
 * (REPLIT_DOMAINS), so the first publish works before the generated
 * *.replit.app hostname is known. Outside production the Vite dev origin is
 * the last resort; production with no resolvable origin refuses to start.
 */
export function allowedOrigins(): string[] {
  const list = (value: string | undefined) =>
    (value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const explicit = list(process.env.APP_ORIGINS);
  if (explicit.length) return explicit;
  const replit = list(process.env.REPLIT_DOMAINS).map((d) => `https://${d}`);
  if (replit.length) return replit;
  return process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173"];
}
