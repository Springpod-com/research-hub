export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (!(options.body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { ...headers, ...options.headers },
  });
  if (!r.ok) {
    let message = `Request failed (${r.status})`;
    try {
      message = (await r.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return r.json();
}
export const post = (path: string, body: unknown) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export async function download(path: string, filename: string) {
  const r = await fetch(`/api${path}`, { credentials: "same-origin" });
  if (!r.ok) {
    let message = "Download failed. Sign in again or check your access.";
    try {
      message = (await r.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
