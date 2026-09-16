// Hash routing with view state in the query string, e.g.
// #/org/<id>/evidence?role=<roleId>&status=accepted&q=deliveries
// Keeping the role scope and list filters in the URL means Back restores
// them and a filtered view can be shared as a link.
export type Params = Record<string, string | undefined>;

export function currentRoute() {
  return location.hash.slice(1) || "/";
}

export function splitRoute(route: string): [string, URLSearchParams] {
  const i = route.indexOf("?");
  return i < 0
    ? [route, new URLSearchParams()]
    : [route.slice(0, i), new URLSearchParams(route.slice(i + 1))];
}

/** Builds a hash href; empty and undefined values are left out. */
export function href(path: string, params?: Params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v) q.set(k, v);
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}
