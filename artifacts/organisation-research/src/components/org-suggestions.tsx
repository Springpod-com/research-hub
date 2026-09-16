import { useEffect, useState } from "react";
import { api } from "../api";
import * as U from "../ui";

export interface OrgSuggestion {
  id: string;
  name: string;
  website: string;
  country: string;
  division: string;
  summary: string;
  reasons: string[];
}
/**
 * Likely existing records for the organisation being created. Suggestions are
 * explained (same domain, similar name) so the researcher decides whether to
 * open the existing record instead of creating a duplicate.
 */
export function OrgSuggestions({
  name,
  website,
  onOpen,
}: {
  name: string;
  website: string;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<OrgSuggestion[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (name.trim().length < 3 && !website.trim()) {
      setItems([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const q = new URLSearchParams({
        name: name.trim(),
        website: website.trim(),
      });
      api<{ suggestions: OrgSuggestion[] }>(`/organisations/suggest?${q}`)
        .then((r) => {
          if (live) {
            setItems(r.suggestions);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError((e as Error).message);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, website]);
  if (error)
    return (
      <U.Alert>
        <U.AlertDescription>
          Could not check existing organisations: {error}
        </U.AlertDescription>
      </U.Alert>
    );
  if (!items.length) return null;
  return (
    <div
      className="rounded-xl border border-border p-4 space-y-3"
      role="status"
    >
      <p className="text-label-3">
        Possible existing {items.length === 1 ? "record" : "records"}
      </p>
      {items.map((s) => (
        <div
          key={s.id}
          className="flex flex-wrap items-start justify-between gap-3 bg-muted rounded-lg p-3"
        >
          <div className="min-w-0">
            <p className="text-p3 font-medium">
              {s.name}
              {s.division ? ` · ${s.division}` : ""}
            </p>
            <p className="text-p5 text-muted-foreground">
              {[s.country, s.website].filter(Boolean).join(" · ")}
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {s.reasons.map((r) => (
                <U.Badge key={r} variant="outline">
                  {r}
                </U.Badge>
              ))}
            </div>
          </div>
          <U.Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpen(s.id)}
          >
            Open existing record
          </U.Button>
        </div>
      ))}
      <p className="text-p5 text-muted-foreground">
        Create a new record only if none of these is the same organisation. A
        different division of the same organisation is allowed.
      </p>
    </div>
  );
}
