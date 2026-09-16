import { useEffect, useState, type ReactNode } from "react";
import type { ResearchJob, Role } from "../../shared/types";
import * as U from "../ui";

export type Tier = ResearchJob["tier"];
export const TIER_NAME: Record<Tier, string> = {
  economy: "Economy",
  power: "Power",
  max: "Max",
};
export const isActive = (j: ResearchJob) =>
  j.status === "queued" || j.status === "researching";
const time = (s: string) => new Date(s).getTime();
const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Re-renders once a second while `on` is true (an active run is on screen). */
export function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function elapsed(j: ResearchJob, now: number) {
  return (isActive(j) ? now : time(j.updatedAt)) - time(j.createdAt);
}

/** Median wall time of the last few finished runs of a tier, if any. */
export function typicalDuration(jobs: ResearchJob[], tier: Tier) {
  const times = jobs
    .filter(
      (j) =>
        j.tier === tier && (j.status === "completed" || j.status === "gaps"),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-5)
    .map((j) => time(j.updatedAt) - time(j.createdAt))
    .filter((t) => t > 0)
    .sort((a, b) => a - b);
  return times.length ? times[Math.floor(times.length / 2)] : undefined;
}

export function scopeTitle(j: ResearchJob, roles: Role[]) {
  return j.roleId
    ? roles.find((r) => r.id === j.roleId)?.title || "Removed role"
    : "Whole organisation";
}

type Step = {
  title: string;
  status: "done" | "current" | "upcoming";
  description?: string;
  failed?: boolean;
};
const STEPS = [
  "Queued",
  "Reading sources",
  "Analysing evidence",
  "Ready for review",
];
/**
 * The run's position in the pipeline, derived from its status and the
 * server's stage text. A stopped run keeps the steps it reached and ends on
 * the outcome instead of listing steps that will never happen.
 */
export function steps(j: ResearchJob): Step[] {
  const reached =
    j.status === "queued"
      ? 0
      : j.status === "researching"
        ? /analys|running/i.test(j.stage)
          ? 2
          : 1
        : j.status === "completed" || j.status === "gaps"
          ? 3
          : j.runs.length
            ? 2
            : j.attempts
              ? 1
              : 0;
  if (j.status === "failed" || j.status === "cancelled")
    return [
      ...STEPS.slice(0, reached).map((title) => ({
        title,
        status: "done" as const,
      })),
      j.status === "failed"
        ? {
            title: "Could not complete",
            status: "current" as const,
            failed: true,
            description:
              "The provider or a source did not respond as expected. Evidence already extracted has been kept.",
          }
        : {
            title: "Cancelled",
            status: "current" as const,
            description: "Evidence already extracted has been kept.",
          },
    ];
  return STEPS.map((title, i) => ({
    title,
    status:
      i < reached || reached === 3
        ? "done"
        : i === reached
          ? "current"
          : "upcoming",
    description:
      i === reached && isActive(j)
        ? j.stage
        : i === 3 && j.status === "gaps"
          ? "Some sources or analyses did not complete; see the limitations below."
          : undefined,
  }));
}

export function RunCard({
  job: j,
  roles,
  badge,
  busy,
  onCancel,
  onRetry,
}: {
  job: ResearchJob;
  roles: Role[];
  badge: ReactNode;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const active = isActive(j);
  // Only a live run ticks; finished runs render once.
  const now = useNow(active);
  return (
    <div className="border border-border rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap gap-3 justify-between">
        <div className="min-w-0">
          <p className="text-p3 font-medium">{scopeTitle(j, roles)}</p>
          <p className="text-p5 text-muted-foreground">
            {TIER_NAME[j.tier]} · started {when(j.createdAt)} ·{" "}
            {active ? "running for" : "took"} {duration(elapsed(j, now))}
            {j.promptVersion ? ` · instructions v${j.promptVersion}` : ""}
          </p>
        </div>
        {badge}
      </div>
      <U.Timeline aria-label="Research progress">
        {steps(j).map((s) => (
          <U.TimelineItem key={s.title} status={s.status}>
            <U.TimelineTitle
              className={s.failed ? "text-destructive" : undefined}
            >
              {s.title}
            </U.TimelineTitle>
            {s.description && (
              <U.TimelineDescription>{s.description}</U.TimelineDescription>
            )}
          </U.TimelineItem>
        ))}
      </U.Timeline>
      {active && (
        <p className="text-p5 text-muted-foreground">
          Duration depends on the tier and the amount of source material. This
          page updates automatically.
        </p>
      )}
      {j.runs.length > 0 && (
        <div className="space-y-1">
          {j.runs.map((r) => (
            <p key={r.id} className="text-p5 text-muted-foreground">
              {r.model}: {r.status} · {r.findings} findings ·{" "}
              {r.inputTokens + r.outputTokens} tokens
            </p>
          ))}
        </div>
      )}
      {j.errors.length > 0 && (
        <details>
          <summary className="text-p4 cursor-pointer">
            {j.status === "failed" ? "Technical details" : "Limitations"} (
            {j.errors.length})
          </summary>
          <ul className="text-p5 space-y-2 mt-3 list-disc pl-5 break-words">
            {j.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {active && (
          <U.Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel run
          </U.Button>
        )}
        {(j.status === "failed" || j.status === "cancelled") && (
          <U.Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onRetry}
          >
            <U.IconRenew size={16} />
            Run again
          </U.Button>
        )}
      </div>
    </div>
  );
}

/** One-line live status shown above the tabs while research is running. */
export function ActiveRunBanner({
  jobs,
  roles,
  busy,
  onView,
  onCancel,
}: {
  jobs: ResearchJob[];
  roles: Role[];
  busy: boolean;
  onView: () => void;
  onCancel: (j: ResearchJob) => void;
}) {
  const now = useNow(jobs.length > 0);
  if (!jobs.length) return null;
  // Not a live region: the elapsed time changes every second and would be
  // read out continuously. Start and finish are announced by toasts.
  return (
    <U.Alert className="mb-6" role="region" aria-label="Research in progress">
      <U.AlertTitle className="flex items-center gap-2">
        <U.Spinner className="size-4" />
        Research in progress
      </U.AlertTitle>
      <U.AlertDescription>
        <ul className="space-y-1">
          {jobs.map((j) => {
            const current = steps(j).find((s) => s.status === "current");
            return (
              <li key={j.id} className="flex flex-wrap items-center gap-x-2">
                <span>
                  {scopeTitle(j, roles)} · {current?.title.toLowerCase()} ·
                  running for {duration(elapsed(j, now))}
                </span>
                <U.Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={busy}
                  onClick={() => onCancel(j)}
                >
                  Cancel
                </U.Button>
              </li>
            );
          })}
        </ul>
        <U.Button
          variant="link"
          size="sm"
          className="h-auto p-0 mt-2"
          onClick={onView}
        >
          View progress
        </U.Button>
      </U.AlertDescription>
    </U.Alert>
  );
}
