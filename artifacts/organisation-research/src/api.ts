/** An API failure; `status` is the HTTP status, or 0 when no response arrived. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
/**
 * Called before a request is retried after a 401. Clerk keeps the session in
 * a short-lived cookie that its browser SDK renews; a request can still race
 * that renewal (most often in a tab that was in the background), so the app
 * registers a function that asks Clerk for a fresh session token first.
 */
let refreshSession: (() => Promise<unknown>) | undefined;
export const setSessionRefresher = (fn?: () => Promise<unknown>) => {
  refreshSession = fn;
};
// Requests that fail together (the two polled reads) share one renewal.
let refreshing: Promise<unknown> | undefined;
const refreshed = () => {
  if (!refreshSession) return Promise.resolve();
  refreshing ??= refreshSession()
    .catch(() => undefined)
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
};
async function send(path: string, options: RequestInit) {
  const headers: Record<string, string> = {};
  if (!(options.body instanceof FormData))
    headers["Content-Type"] = "application/json";
  try {
    return await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { ...headers, ...options.headers },
    });
  } catch {
    throw new ApiError("The workspace could not be reached.", 0);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await request(path, options);
  if (!r.ok) throw await failure(r, `Request failed (${r.status})`);
  return r.json();
}
/** Sends a request, renewing the session and retrying once after a 401. */
async function request(path: string, options: RequestInit) {
  let r = await send(path, options);
  if (r.status === 401 && refreshSession) {
    await refreshed();
    r = await send(path, options);
  }
  return r;
}
async function failure(r: Response, fallback: string) {
  let message = fallback;
  try {
    message = (await r.json()).error || message;
  } catch {}
  return new ApiError(message, r.status);
}
/** Fetches a file (download, image preview) with the same session recovery. */
export async function fetchBlob(path: string, fallback: string) {
  const r = await request(path, {});
  if (!r.ok) throw await failure(r, fallback);
  return r.blob();
}
export const post = (path: string, body: unknown) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = (path: string, body: unknown) =>
  api(path, { method: "DELETE", body: JSON.stringify(body) });
export async function download(path: string, filename: string) {
  const blob = await fetchBlob(
    path,
    "Download failed. Sign in again or check your access.",
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
