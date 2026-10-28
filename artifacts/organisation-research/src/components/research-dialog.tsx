import { useEffect, useMemo, useState } from "react";
import type {
  Organisation,
  ResearchJob,
  Role,
  Section,
  SectionsResponse,
  Source,
} from "../../shared/types";
import { api } from "../api";
import * as U from "../ui";
import { useFormCloseGuard } from "./form-close-guard";
import { sectionSelectionReason } from "./folder-workflow";
import { duration, isActive, typicalDuration } from "./research-runs";

const ORG_SCOPE = "organisation";

export function ResearchDialog({
  org,
  roles,
  jobs,
  sources,
  ready,
  initialRoleId,
  initialSection,
  initialSourceIds,
  onClose,
  onStart,
}: {
  org: Organisation;
  roles: Role[];
  jobs: ResearchJob[];
  /** The organisation's readable sources (text captured, no error). */
  sources: Pick<Source, "id" | "roleIds" | "title" | "folder" | "retrievedAt">[];
  /** The server has a research model and provider access. */
  ready: boolean;
  initialRoleId?: string;
  initialSection?: Section;
  initialSourceIds?: string[];
  onClose: () => void;
  onStart: (
    roleId: string | undefined,
    sections?: Section[],
    sourceIds?: string[],
    crawl?: boolean,
  ) => Promise<void>;
}) {
  const [scope, setScope] = useState(initialRoleId || ORG_SCOPE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sectionsError, setSectionsError] = useState("");
  const [sectionData, setSectionData] = useState<SectionsResponse>();
  const [chosenSections, setChosenSections] = useState<Section[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  // Picked by hand: the run then reads exactly these in one analysis.
  // Otherwise each chosen section is researched separately (plan P1.5).
  const [sourcesPicked, setSourcesPicked] = useState(!!initialSourceIds);
  const [crawl, setCrawl] = useState(false);
  const [initial] = useState({ scope });
  const dirty =
    scope !== initial.scope ||
    !!chosenSections.length ||
    !!sourceIds.length ||
    crawl;
  const closeGuard = useFormCloseGuard({ dirty, busy, onClose });
  const roleId = scope === ORG_SCOPE ? undefined : scope;
  useEffect(() => {
    let live = true;
    setSectionData(undefined);
    setSectionsError("");
    setChosenSections([]);
    setSourceIds([]);
    api<SectionsResponse>(
      `/orgs/${org.id}/sections${roleId ? `?roleId=${encodeURIComponent(roleId)}` : ""}`,
    )
      .then((result) => {
        if (!live) return;
        setSectionData(result);
        const defaults = initialSection
          ? result.sections
              .filter(
                (section) =>
                  section.section === initialSection &&
                  !sectionSelectionReason(section, roleId),
              )
              .map((section) => section.section)
          : result.sections
              .filter((section) => !sectionSelectionReason(section, roleId))
              .map((section) => section.section);
        setChosenSections(defaults);
      })
      .catch((caught) => {
        if (live) setSectionsError((caught as Error).message);
      });
    return () => {
      live = false;
    };
  }, [org.id, roleId, initialSection]);
  const eligibleSources = useMemo(() => {
    const folders = new Set(
      (sectionData?.sections || [])
        .filter(
          (section) =>
            chosenSections.includes(section.section) ||
            section.section === "organisation",
        )
        .map((section) => section.folder),
    );
    const priority = new Map(
      (initialSourceIds || []).map((sourceId, index) => [sourceId, index]),
    );
    return sources
      .filter(
        (source) =>
          (!source.roleIds.length ||
            !roleId ||
            source.roleIds.includes(roleId)) &&
          !!source.folder &&
          folders.has(source.folder),
      )
      .sort((a, b) => {
        const aPriority = priority.get(a.id);
        const bPriority = priority.get(b.id);
        if (aPriority !== undefined || bPriority !== undefined)
          return (aPriority ?? Number.MAX_SAFE_INTEGER) -
            (bPriority ?? Number.MAX_SAFE_INTEGER);
        return b.retrievedAt.localeCompare(a.retrievedAt);
      });
  }, [chosenSections, roleId, sectionData, sources, initialSourceIds]);
  useEffect(() => {
    const defaults = initialSourceIds
      ? eligibleSources
          .filter((source) => initialSourceIds.includes(source.id))
          .slice(0, 16)
          .map((source) => source.id)
      : eligibleSources.slice(0, 16).map((source) => source.id);
    setSourceIds(defaults);
    setCrawl(defaults.length === 0);
  }, [eligibleSources.map((source) => source.id).join(",")]);
  const running = jobs.find(
    (j) => j.orgId === org.id && j.roleId === roleId && isActive(j),
  );
  const readable = sources.filter(
    (source) =>
      !source.roleIds.length || !roleId || source.roleIds.includes(roleId),
  ).length;
  const nothingToRead = sourceIds.length === 0 && (!crawl || !org.website);
  const typical = typicalDuration(jobs);
  return (
    <U.Dialog
      open
      onOpenChange={(v) => {
        closeGuard.onOpenChange(v);
      }}
    >
      <U.DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <U.DialogHeader>
          <U.DialogTitle>Extract facts and evidence</U.DialogTitle>
          <U.DialogDescription>
            Reads the selected captured sources for {org.name}, then registers
            evidence-backed facts and drafts questions for the organisation.
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
            <legend className="text-p4 font-medium">Sections to fill</legend>
            {!sectionData ? (
              <U.Skeleton className="h-24 rounded-xl" />
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sectionData.sections.map((section) => {
                  const unavailable = sectionSelectionReason(section, roleId);
                  return (
                    <label
                      key={section.section}
                      className={U.cn("flex items-start gap-2 text-p4", unavailable && "text-muted-foreground")}
                    >
                      <U.Checkbox
                        checked={chosenSections.includes(section.section)}
                        disabled={!!unavailable}
                        onCheckedChange={(checked) =>
                          setChosenSections((current) =>
                            checked
                              ? [...current, section.section]
                              : current.filter(
                                  (value) => value !== section.section,
                                ),
                          )
                        }
                      />
                      <span>
                        {section.title}
                        <span className="block text-p5 text-muted-foreground">
                          {unavailable ||
                            `${section.gaps.length} place${section.gaps.length === 1 ? "" : "s"} to fill`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          {!!sectionData && !chosenSections.length && (
            <p className="text-p5 text-muted-foreground">
              Choose at least one available folder to extract.
            </p>
          )}
          <label className="flex items-start gap-2 text-p4">
            <U.Checkbox
              checked={crawl}
              disabled={!org.website}
              onCheckedChange={(checked) => setCrawl(checked === true)}
            />
            <span>
              Also read the organisation&apos;s website
              <span className="block text-p5 text-muted-foreground">
                Crawl the public website as well as the folder material selected above.
              </span>
            </span>
          </label>
          {!!sectionData && (
            <div className="space-y-2">
              <p className="text-p4 font-medium">Places to fill</p>
              <ul className="max-h-36 overflow-y-auto rounded-xl bg-muted p-3 text-p5">
                {sectionData.missing
                  .filter((missing) =>
                    sectionData.sections.some(
                      (section) =>
                        chosenSections.includes(section.section) &&
                        missing.startsWith(`${section.title}:`),
                    ),
                  )
                  .map((missing) => (
                    <li key={missing}>• {missing}</li>
                  ))}
              </ul>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="text-p4 font-medium">
              Sources to read ({sourceIds.length}/16)
            </legend>
            <p className="text-p5 text-muted-foreground">
              Each chosen section is researched separately and at the same
              time, reading its own sources first and then organisation
              context. Untick a source to choose exactly what one combined
              analysis reads instead (up to 16).
            </p>
            <div className="max-h-48 overflow-y-auto space-y-2 rounded-xl border border-border p-3">
              {eligibleSources.map((source) => (
                <label key={source.id} className="flex items-start gap-2 text-p4">
                  <U.Checkbox
                    checked={sourceIds.includes(source.id)}
                    disabled={
                      !sourceIds.includes(source.id) && sourceIds.length >= 16
                    }
                    onCheckedChange={(checked) => {
                      setSourcesPicked(true);
                      setSourceIds((current) =>
                        checked
                          ? [...current, source.id].slice(0, 16)
                          : current.filter((id) => id !== source.id),
                      );
                    }}
                  />
                  {source.title}
                </label>
              ))}
              {!eligibleSources.length && (
                <p className="text-p5 text-muted-foreground">
                  No captured sources belong to these sections.
                </p>
              )}
            </div>
          </fieldset>
          {ready ? (
            <p className="text-p5 text-muted-foreground">
              {typical
                ? `Recent runs took about ${duration(typical)}.`
                : "No completed runs yet."}
            </p>
          ) : (
            <U.Alert>
              <U.AlertDescription>
                Research is not set up on this server yet. Whoever deploys it
                needs to set the research model (RESEARCH_MODEL) and connect its
                provider.
              </U.AlertDescription>
            </U.Alert>
          )}
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
          {sectionsError && (
            <U.Alert role="alert" variant="destructive">
              <U.AlertTitle>Sections could not be loaded</U.AlertTitle>
              <U.AlertDescription>{sectionsError}</U.AlertDescription>
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
            disabled={
              busy ||
              !ready ||
              !!running ||
              nothingToRead ||
              !sectionData ||
              !chosenSections.length ||
              !!sectionsError
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                if (!sectionData)
                  throw new Error("Folders have not finished loading.");
                const invalidSection = sectionData.sections.find(
                  (section) =>
                    chosenSections.includes(section.section) &&
                    sectionSelectionReason(section, roleId),
                );
                if (invalidSection)
                  throw new Error(
                    sectionSelectionReason(invalidSection, roleId),
                  );
                await onStart(
                  roleId,
                  chosenSections.length ? chosenSections : undefined,
                  sourcesPicked && sourceIds.length ? sourceIds : undefined,
                  crawl,
                );
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <U.IconMagicWand size={20} />
            {busy ? "Starting…" : "Extract facts and evidence"}
          </U.Button>
        </U.DialogFooter>
      </U.DialogContent>
      {closeGuard.confirmation}
    </U.Dialog>
  );
}
