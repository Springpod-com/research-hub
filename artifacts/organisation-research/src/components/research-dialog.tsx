import { useState } from "react";
import type {
  Organisation,
  ResearchJob,
  Role,
  Source,
} from "../../shared/types";
import * as U from "../ui";
import { useFormCloseGuard } from "./form-close-guard";
import {
  TIER_NAME,
  duration,
  isActive,
  typicalDuration,
  type Tier,
} from "./research-runs";

const TIERS: { id: Tier; description: string }[] = [
  {
    id: "economy",
    description:
      "One Gemini analysis. The quickest and lowest-cost pass over the sources; good for a first look.",
  },
  {
    id: "power",
    description:
      "One Claude analysis with deeper synthesis. The usual choice for a role.",
  },
  {
    id: "max",
    description:
      "Two independent analyses of the same sources (Claude and OpenAI) so findings can be cross-checked. The slowest and most expensive.",
  },
];
const REMEMBERED = "organisation-research.tier";
const ORG_SCOPE = "organisation";

export function rememberedTier(): Tier | undefined {
  try {
    const v = localStorage.getItem(REMEMBERED);
    return v && v in TIER_NAME ? (v as Tier) : undefined;
  } catch {
    return undefined;
  }
}

export function ResearchDialog({
  org,
  roles,
  jobs,
  sources,
  tiers,
  initialRoleId,
  onClose,
  onStart,
}: {
  org: Organisation;
  roles: Role[];
  jobs: ResearchJob[];
  /** The organisation's readable sources (text captured, no error). */
  sources: Pick<Source, "roleIds">[];
  tiers: Record<string, boolean>;
  initialRoleId?: string;
  onClose: () => void;
  onStart: (tier: Tier, roleId?: string) => Promise<void>;
}) {
  const [tier, setTier] = useState<Tier>(() => {
    const remembered = rememberedTier();
    if (remembered && tiers[remembered]) return remembered;
    return (
      (["power", "economy", "max"] as Tier[]).find((t) => tiers[t]) || "power"
    );
  });
  const [scope, setScope] = useState(initialRoleId || ORG_SCOPE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [initial] = useState({ tier, scope });
  const dirty = tier !== initial.tier || scope !== initial.scope;
  const closeGuard = useFormCloseGuard({ dirty, busy, onClose });
  const roleId = scope === ORG_SCOPE ? undefined : scope;
  const running = jobs.find(
    (j) => j.orgId === org.id && j.roleId === roleId && isActive(j),
  );
  // Mirrors the server's selection: role-scoped research reads unscoped
  // sources plus those linked to the role; the website is crawled first.
  const readable = sources.filter(
    (s) => !s.roleIds.length || !roleId || s.roleIds.includes(roleId),
  ).length;
  const nothingToRead = !org.website && readable === 0;
  const configured = TIERS.some((t) => tiers[t.id]);
  return (
    <U.Dialog
      open
      onOpenChange={(v) => {
        closeGuard.onOpenChange(v);
      }}
    >
      <U.DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <U.DialogHeader>
          <U.DialogTitle>Start research</U.DialogTitle>
          <U.DialogDescription>
            Reads {org.website ? "the organisation website and " : ""}the
            captured sources for {org.name}, then drafts findings and questions
            for the organisation. Nothing is accepted without a reviewer.
          </U.DialogDescription>
        </U.DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <U.Label htmlFor="research-scope">Research focus</U.Label>
            <U.Select
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setError("");
              }}
            >
              <U.SelectTrigger
                id="research-scope"
                aria-label="Research focus"
                autoFocus
              >
                <U.SelectValue />
              </U.SelectTrigger>
              <U.SelectContent>
                <U.SelectItem value={ORG_SCOPE}>
                  Whole organisation
                </U.SelectItem>
                {roles.map((r) => (
                  <U.SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </U.SelectItem>
                ))}
              </U.SelectContent>
            </U.Select>
            <p className="text-p5 text-muted-foreground">
              Choosing a role adds its responsibilities to the research brief
              and files the results under that role.
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-p4 font-medium">Research tier</legend>
            <U.RadioGroup
              value={tier}
              onValueChange={(v) => {
                setTier(v as Tier);
                setError("");
              }}
              className="gap-3"
            >
              {TIERS.map((t) => {
                const ready = !!tiers[t.id];
                const typical = typicalDuration(jobs, t.id);
                return (
                  <label
                    key={t.id}
                    htmlFor={`tier-${t.id}`}
                    className={U.cn(
                      "flex gap-3 rounded-xl border border-border p-4",
                      ready ? "cursor-pointer" : "opacity-60",
                      tier === t.id &&
                        "border-brand-teal-800 bg-brand-teal-100",
                    )}
                  >
                    <U.RadioGroupItem
                      id={`tier-${t.id}`}
                      value={t.id}
                      disabled={!ready}
                      className="mt-1 shrink-0"
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-p3 font-medium">
                          {TIER_NAME[t.id]}
                        </span>
                        {!ready ? (
                          <U.Badge variant="outline">Needs setup</U.Badge>
                        ) : typical ? (
                          <span className="text-p5 text-muted-foreground">
                            Recent runs took about {duration(typical)}
                          </span>
                        ) : (
                          <span className="text-p5 text-muted-foreground">
                            No completed runs yet
                          </span>
                        )}
                      </span>
                      <span className="block text-p5 text-muted-foreground">
                        {t.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </U.RadioGroup>
            {!configured && (
              <U.Alert>
                <U.AlertDescription>
                  No research tier is set up yet. An administrator can connect
                  the models under Team &amp; settings.
                </U.AlertDescription>
              </U.Alert>
            )}
          </fieldset>
          {running && (
            <U.Alert>
              <U.AlertTitle>Already running</U.AlertTitle>
              <U.AlertDescription>
                Research for this focus is in progress. Wait for it to finish,
                or cancel it from the overview, before starting another.
              </U.AlertDescription>
            </U.Alert>
          )}
          {nothingToRead && (
            <U.Alert>
              <U.AlertTitle>Nothing to read yet</U.AlertTitle>
              <U.AlertDescription>
                Add the organisation website or capture some source material
                first; research works only from recorded sources.
              </U.AlertDescription>
            </U.Alert>
          )}
          {error && (
            <U.Alert role="alert" variant="destructive">
              <U.AlertDescription>{error}</U.AlertDescription>
            </U.Alert>
          )}
        </div>
        <U.DialogFooter>
          <U.Button
            variant="outline"
            disabled={busy}
            onClick={closeGuard.requestClose}
          >
            Cancel
          </U.Button>
          <U.Button
            disabled={busy || !tiers[tier] || !!running || nothingToRead}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onStart(tier, roleId);
                try {
                  localStorage.setItem(REMEMBERED, tier);
                } catch {
                  // Private browsing can refuse storage; the choice is just not remembered.
                }
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <U.IconMagicWand size={20} />
            {busy ? "Starting…" : "Start research"}
          </U.Button>
        </U.DialogFooter>
      </U.DialogContent>
      {closeGuard.confirmation}
    </U.Dialog>
  );
}
