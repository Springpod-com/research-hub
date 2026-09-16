import { useEffect, useState } from "react";
import type { Role } from "../../shared/types";
import type {
  DatasetSummary,
  OccupationCandidate,
  OccupationEntry,
  OccupationScheme,
} from "../../shared/occupations";
import { api } from "../api";
import * as U from "../ui";

type Candidates = Partial<Record<OccupationScheme, OccupationCandidate[]>>;
interface CandidateResponse {
  query: { title: string; context: string; seniority: string };
  candidates: Candidates;
  datasets: DatasetSummary[];
}
interface EntryResponse {
  dataset: DatasetSummary;
  sourceUrl: string;
  entry: OccupationEntry;
}
export interface OccupationRecord {
  scheme: OccupationScheme;
  code: string;
  title: string;
  sourceUrl: string;
  datasetVersion: string;
  rationale: string;
  status: "proposed";
  activities: string[];
  skills: string[];
  knowledge: string[];
  workContext: string[];
  basis: "dataset-search";
  jurisdiction: "UK" | "US";
  retrievedAt: string;
}
const SCHEMES: OccupationScheme[] = ["UK SOC", "O*NET"];
const CONTEXT_FIELDS = [
  ["tasks", "Typical tasks (recorded as activities)"],
  ["skills", "Skills"],
  ["knowledge", "Knowledge"],
  ["workContext", "Work context"],
] as const;
type ContextField = (typeof CONTEXT_FIELDS)[number][0];

/**
 * Finds candidate UK SOC and O*NET occupations for a role using deterministic
 * keyword matching over the bundled official datasets. The researcher reviews
 * the matched terms, chooses which dataset statements to keep as occupational
 * context, and records the match as "proposed" for later confirmation.
 */
export function OccupationMatcher({
  role,
  onClose,
  onRecord,
  onManual,
}: {
  role: Role;
  onClose: () => void;
  onRecord: (record: OccupationRecord) => Promise<void>;
  onManual: () => void;
}) {
  const [auto, setAuto] = useState<CandidateResponse>();
  const [results, setResults] = useState<Candidates>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OccupationCandidate>();
  useEffect(() => {
    let live = true;
    api<CandidateResponse>(`/roles/${role.id}/occupation-candidates`)
      .then((r) => {
        if (live) setAuto(r);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [role.id]);
  async function runSearch() {
    if (query.trim().length < 2) {
      setResults(undefined);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await api<{ candidates: Candidates }>(
        `/occupations/search?${new URLSearchParams({ q: query.trim() })}`,
      );
      setResults(r.candidates);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const candidates = results || auto?.candidates || {};
  const dataset = (scheme: OccupationScheme) =>
    auto?.datasets.find((d) => d.scheme === scheme);
  const recorded = new Set(
    role.occupations.map((o) => `${o.scheme}:${o.code}`),
  );
  return (
    <U.Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <U.DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <U.DialogHeader>
          <U.DialogTitle>
            Find occupational matches — {role.title}
          </U.DialogTitle>
          <U.DialogDescription>
            Candidates come from keyword matching against the bundled official
            datasets. UK SOC 2020 is the primary classification; O*NET describes
            US occupations and is supplementary. Nothing is recorded until you
            choose a match, and it stays “proposed” until a reviewer confirms
            it.
          </U.DialogDescription>
        </U.DialogHeader>
        {selected ? (
          <CandidateDetail
            candidate={selected}
            dataset={dataset(selected.scheme)}
            alreadyRecorded={recorded.has(
              `${selected.scheme}:${selected.code}`,
            )}
            onBack={() => setSelected(undefined)}
            onRecord={async (record) => {
              await onRecord(record);
              onClose();
            }}
          />
        ) : (
          <div className="space-y-5">
            {auto && !results && (
              <p className="text-p5 text-muted-foreground">
                Searched with the job title
                {auto.query.seniority ? ", seniority" : ""}
                {auto.query.context ? " and responsibilities" : ""}. Refine
                below if the role title is unusual.
              </p>
            )}
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
            >
              <U.Input
                aria-label="Search occupations"
                placeholder="Search by job title or task, e.g. forklift, payroll"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 min-w-[16rem]"
              />
              <U.Button type="submit" variant="outline" disabled={loading}>
                Search
              </U.Button>
              {results && (
                <U.Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setResults(undefined);
                    setQuery("");
                  }}
                >
                  Back to role suggestions
                </U.Button>
              )}
            </form>
            {error && (
              <U.Alert role="alert">
                <U.AlertDescription>{error}</U.AlertDescription>
              </U.Alert>
            )}
            {loading && <U.Skeleton className="h-24 w-full" />}
            {!loading &&
              SCHEMES.map((scheme) => {
                const list = candidates[scheme] || [];
                const d = dataset(scheme);
                return (
                  <section key={scheme} className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-h6">{scheme}</h3>
                      <U.Badge variant="outline">
                        {scheme === "UK SOC"
                          ? "UK · primary"
                          : "US · supplementary"}
                      </U.Badge>
                      {d && (
                        <span className="text-p5 text-muted-foreground">
                          {d.version} · {d.licence}
                        </span>
                      )}
                    </div>
                    {list.length ? (
                      list.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          className="w-full text-left bg-muted rounded-xl p-4 space-y-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setSelected(c)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-p3 font-medium">
                              {c.code} · {c.title}
                            </span>
                            {recorded.has(`${c.scheme}:${c.code}`) && (
                              <U.Badge variant="outline">
                                Already recorded
                              </U.Badge>
                            )}
                          </div>
                          <p className="text-p5 text-muted-foreground line-clamp-2">
                            {c.description}
                          </p>
                          <p className="text-p5">
                            Matched:{" "}
                            {c.matchedTerms
                              .map(
                                (m) =>
                                  `${m.terms.join(", ")} (${fieldLabel(m.field)})`,
                              )
                              .join(" · ")}
                          </p>
                        </button>
                      ))
                    ) : (
                      <p className="text-p4 text-muted-foreground">
                        No {scheme} occupations matched these terms.
                      </p>
                    )}
                  </section>
                );
              })}
            <U.DialogFooter className="sm:justify-between">
              <U.Button type="button" variant="ghost" onClick={onManual}>
                Record a match manually instead
              </U.Button>
              <U.Button type="button" variant="outline" onClick={onClose}>
                Close
              </U.Button>
            </U.DialogFooter>
          </div>
        )}
      </U.DialogContent>
    </U.Dialog>
  );
}
function fieldLabel(field: string) {
  return (
    {
      title: "title",
      altTitles: "index titles",
      description: "description",
      tasks: "tasks",
    }[field] || field
  );
}
function CandidateDetail({
  candidate: c,
  dataset,
  alreadyRecorded,
  onBack,
  onRecord,
}: {
  candidate: OccupationCandidate;
  dataset?: DatasetSummary;
  alreadyRecorded: boolean;
  onBack: () => void;
  onRecord: (record: OccupationRecord) => Promise<void>;
}) {
  const [detail, setDetail] = useState<EntryResponse>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState(c.rationale);
  const [picked, setPicked] = useState<Record<ContextField, Set<string>>>({
    tasks: new Set(),
    skills: new Set(),
    knowledge: new Set(),
    workContext: new Set(),
  });
  useEffect(() => {
    let live = true;
    api<EntryResponse>(
      `/occupations/entry?${new URLSearchParams({ scheme: c.scheme, code: c.code })}`,
    )
      .then((r) => {
        if (!live) return;
        setDetail(r);
        // Pre-select the leading statements; the researcher trims or extends.
        setPicked({
          tasks: new Set(r.entry.tasks.slice(0, 6)),
          skills: new Set(r.entry.skills.slice(0, 6)),
          knowledge: new Set(r.entry.knowledge.slice(0, 6)),
          workContext: new Set(r.entry.workContext.slice(0, 4)),
        });
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [c.scheme, c.code]);
  const toggle = (field: ContextField, value: string) =>
    setPicked((p) => {
      const next = new Set(p[field]);
      if (next.has(value)) next.delete(value);
      else if (next.size < 30) next.add(value);
      return { ...p, [field]: next };
    });
  async function record() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await onRecord({
        scheme: c.scheme,
        code: c.code,
        title: c.title,
        sourceUrl: c.sourceUrl,
        datasetVersion: c.datasetVersion,
        rationale: rationale.trim() || c.rationale,
        status: "proposed",
        activities: detail.entry.tasks.filter((t) => picked.tasks.has(t)),
        skills: detail.entry.skills.filter((t) => picked.skills.has(t)),
        knowledge: detail.entry.knowledge.filter((t) =>
          picked.knowledge.has(t),
        ),
        workContext: detail.entry.workContext.filter((t) =>
          picked.workContext.has(t),
        ),
        basis: "dataset-search",
        jurisdiction: c.jurisdiction,
        retrievedAt: (dataset || detail.dataset).retrievedAt,
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <U.Button type="button" variant="ghost" size="sm" onClick={onBack}>
        ← Back to candidates
      </U.Button>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-h6">
            {c.scheme} {c.code} · {c.title}
          </h3>
          <U.Badge variant="outline">
            {c.jurisdiction === "UK"
              ? "UK data"
              : "US data — check UK relevance"}
          </U.Badge>
        </div>
        <p className="text-p4">{c.description}</p>
        <p className="text-p5 text-muted-foreground">
          {c.datasetVersion}
          {dataset ? ` · ${dataset.publisher} · ${dataset.licence}` : ""} ·{" "}
          <a
            className="underline"
            href={c.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Official source
          </a>
        </p>
        {c.matchedTitles.length > 0 && (
          <p className="text-p5">
            Matching index titles: {c.matchedTitles.join("; ")}
          </p>
        )}
      </div>
      {c.scheme === "O*NET" && (
        <U.Alert>
          <U.AlertDescription>
            O*NET describes occupations in the United States. Review each
            statement for relevance to this UK role before keeping it.
          </U.AlertDescription>
        </U.Alert>
      )}
      {error && (
        <U.Alert role="alert">
          <U.AlertDescription>{error}</U.AlertDescription>
        </U.Alert>
      )}
      {!detail && !error && <U.Skeleton className="h-40 w-full" />}
      {detail && (
        <>
          {detail.entry.entryRoutes && (
            <div>
              <p className="text-label-3 mb-1">Typical entry routes (ONS)</p>
              <p className="text-p5 text-muted-foreground">
                {detail.entry.entryRoutes}
              </p>
            </div>
          )}
          {CONTEXT_FIELDS.map(([field, label]) => {
            const values = detail.entry[field];
            if (!values.length) return null;
            return (
              <fieldset key={field} className="space-y-2">
                <legend className="text-label-3 mb-1">
                  {label} · {picked[field].size} selected
                </legend>
                {values.map((v, i) => {
                  const id = `${field}-${i}`;
                  return (
                    <div key={id} className="flex items-start gap-2">
                      <U.Checkbox
                        id={id}
                        checked={picked[field].has(v)}
                        onCheckedChange={() => toggle(field, v)}
                      />
                      <U.Label
                        htmlFor={id}
                        className="text-p5 font-normal"
                      >
                        {v}
                      </U.Label>
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
        </>
      )}
      <div className="space-y-2">
        <U.Label htmlFor="match-rationale">Why this matches the role</U.Label>
        <U.Textarea
          id="match-rationale"
          rows={4}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
        <p className="text-p5 text-muted-foreground">
          Generated from the matched terms. Edit it to reflect your judgement;
          it is stored with the match.
        </p>
      </div>
      <U.DialogFooter>
        <U.Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={busy}
        >
          Cancel
        </U.Button>
        <U.Button
          type="button"
          onClick={() => void record()}
          disabled={busy || !detail || alreadyRecorded}
        >
          {alreadyRecorded
            ? "Already recorded"
            : busy
              ? "Recording…"
              : "Record as proposed match"}
        </U.Button>
      </U.DialogFooter>
    </div>
  );
}
