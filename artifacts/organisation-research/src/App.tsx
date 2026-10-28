import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import type {
  Workspace,
  Organisation,
  Role,
  Source,
  Finding,
  Question,
  Activity,
  Pack,
  Session,
  ResearchJob,
  Folder,
  Part,
  Rights,
  Section,
  SectionsResponse,
  Slot,
  Tier,
} from "../shared/types";
import {
  labels as sharedLabels,
  sectionOfSlot,
  sections as sharedSections,
  slots,
  tierNames,
} from "../shared/types";
import {
  api,
  apiTagged,
  post,
  patch,
  del,
  download,
  fetchBlob,
  ApiError,
} from "./api";
import { ResearchWorkspacePage } from "./components/research-workspace-page";
import * as U from "./ui";
import { OrgSuggestions } from "./components/org-suggestions";
import { ResearchSettings } from "./components/research-settings";
import {
  OccupationMatcher,
  type OccupationRecord,
} from "./components/occupation-matcher";
import { ResearchDialog } from "./components/research-dialog";
import { SectionsView } from "./components/sections-view";
import { FolderView } from "./components/folder-view";
import { NoteForm } from "./components/note-form";
import {
  canEditSectionNote,
  extractionSourceIds,
  noteRoleIds,
  retryResearchBody,
  runWorkspaceAction,
  validFolderSection,
} from "./components/folder-workflow";
import { FactPlacement } from "./components/fact-placement";
import { QuestionFactDialog } from "./components/question-fact-dialog";
import { RecordFactDialog } from "./components/record-fact-dialog";
import {
  FactFields,
  factFieldsClaim,
  normaliseFactFields,
  type FactFieldValues,
} from "./components/fact-fields";
import { AutoTextarea } from "./components/auto-textarea";
import { useFormCloseGuard } from "./components/form-close-guard";
import { TabStrip, useScrolledPast } from "./components/tab-strip";
import { WhatsThis } from "./components/whats-this";
import { DismissibleNote } from "./components/dismissible-note";
import { uploadFiles } from "./uploadBatch";
import {
  ActiveRunBanner,
  RunCard,
  TIER_NAME,
  isActive,
  scopeTitle,
} from "./components/research-runs";
import { currentRoute, href, splitRoute } from "./route";
// Poll cadence in milliseconds: quick while a research run is in progress so
// its stages show as they happen, relaxed otherwise.
const POLL_ACTIVE = 3000;
const POLL_IDLE = 12000;
// Shown wherever a readiness check appears, so the term is explained the
// same way everywhere.
const READINESS_HELP =
  "Readiness means the role's research passes the handover checks: responsibilities are described, evidence is accepted and valid, reviews and blocking questions are complete, and research runs have finished. It is a research milestone, not the organisation's approval.";
const labels: Record<string, string> = {
  ...sharedLabels,
};
const FOLDER_OPTIONS: [string, string][] = [
  ["auto", "Choose automatically"],
  ...sharedSections.map(
    (section) => [section.folder, section.title] as [string, string],
  ),
];
const folderTitle = (folder?: Folder) =>
  sharedSections.find((section) => section.folder === folder)?.title ||
  "Choose automatically";
const slotLabel = (slot?: Slot) =>
  slots.find((item) => item.slot === slot)?.label;
const TABS: [string, string][] = [
  ["overview", "Overview"],
  ["roles", "Roles"],
  ["evidence", "Evidence"],
  ["questions", "Questions"],
  ["packs", "Research packs"],
];
const date = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((v) => v[0])
    .join("")
    .toUpperCase();
type Data = Workspace & { packs: Pack[] };
type Modal = { type: string; item?: any };
type Field = {
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  kind?: "textarea" | "select" | "file";
  options?: [string, string][];
  hint?: string;
  validateUrl?: boolean;
  multiple?: boolean;
};
type FormSubmitContext = {
  files: File[];
  setBusyLabel: (label: string) => void;
  clearFiles: () => void;
};
function Pick({
  value,
  onChange,
  options,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <U.Select value={value} onValueChange={onChange}>
      <U.SelectTrigger
        aria-label={label}
        className="min-w-0"
        autoFocus={autoFocus}
      >
        <U.SelectValue placeholder={label} />
      </U.SelectTrigger>
      <U.SelectContent>
        {options.map(([v, l]) => (
          <U.SelectItem key={v} value={v}>
            {l}
          </U.SelectItem>
        ))}
      </U.SelectContent>
    </U.Select>
  );
}
const WEB_ADDRESS_ERROR = "Enter a valid web address, e.g. https://example.com";
function normaliseWebAddress(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")
    )
      return;
    return parsed.toString();
  } catch {
    return;
  }
}
function Status({ value }: { value: string }) {
  return (
    <U.Badge
      className={U.cn(
        "font-medium",
        value === "accepted" || value === "ready" || value === "completed"
          ? "bg-brand-alert-success-light text-brand-alert-success-dark"
          : value === "clarification" || value === "client" || value === "gaps"
            ? "bg-brand-alert-warning-light text-brand-alert-warning-dark"
            : "bg-muted text-muted-foreground",
      )}
    >
      {labels[value] ||
        (
          { ready: "Ready for storyboarding", draft: "Draft" } as Record<
            string,
            string
          >
        )[value] ||
        value}
    </U.Badge>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-12 px-6 text-center space-y-4">
      <U.IconFiles size={32} className="mx-auto text-muted-foreground" />
      <h3 className="text-h6">{title}</h3>
      <p className="text-p3 text-muted-foreground max-w-lg mx-auto">
        {description}
      </p>
      {action}
    </div>
  );
}
function FormModal({
  title,
  description,
  fields,
  onClose,
  onSubmit,
  submitLabel = "Save",
  busyLabel = "Saving…",
  submitVariant = "default",
  render,
}: {
  title: string;
  description: string;
  fields: Field[];
  onClose: () => void;
  onSubmit: (
    values: Record<string, string>,
    file?: File,
    context?: FormSubmitContext,
  ) => Promise<void>;
  submitLabel?: string;
  busyLabel?: string | ((file?: File) => string);
  submitVariant?: "default" | "destructive";
  /** Extra content rendered below the fields, given the live values. */
  render?: (values: Record<string, string>) => ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.value || ""])),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activeBusyLabel, setActiveBusyLabel] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const initialValues = useRef(values).current;
  const dirty =
    files.length > 0 ||
    fields.some((field) => values[field.name] !== initialValues[field.name]);
  const closeGuard = useFormCloseGuard({ dirty, busy, onClose });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setActiveBusyLabel(
      typeof busyLabel === "function" ? busyLabel(files[0]) : busyLabel,
    );
    setError("");
    setFieldErrors({});
    const submittedValues = { ...values };
    const nextFieldErrors: Record<string, string> = {};
    for (const field of fields) {
      if (!field.validateUrl) continue;
      const normalised = normaliseWebAddress(values[field.name]);
      if (values[field.name].trim() && !normalised)
        nextFieldErrors[field.name] = WEB_ADDRESS_ERROR;
      else submittedValues[field.name] = normalised || "";
    }
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setBusy(false);
      return;
    }
    try {
      await onSubmit(submittedValues, files[0], {
        files,
        // A route change can unmount the dialog mid-batch; later files must
        // not touch its state.
        setBusyLabel: (label) => {
          if (mounted.current) setActiveBusyLabel(label);
        },
        clearFiles: () => {
          if (!mounted.current) return;
          setFiles([]);
          setFileInputKey((value) => value + 1);
        },
      });
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <U.Dialog
      open
      onOpenChange={(v) => {
        closeGuard.onOpenChange(v);
      }}
    >
      <U.DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <U.DialogHeader>
          <U.DialogTitle>{title}</U.DialogTitle>
          <U.DialogDescription>{description}</U.DialogDescription>
        </U.DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          {fields.map((f, index) => (
            <div key={f.name} className="space-y-2">
              <U.Label htmlFor={`field-${f.name}`}>
                {f.label}
                {f.required ? " *" : ""}
              </U.Label>
              {f.kind === "select" ? (
                <Pick
                  label={f.label}
                  value={values[f.name] || (undefined as any)}
                  onChange={(v) => {
                    setValues({ ...values, [f.name]: v });
                    setError("");
                    setFieldErrors({ ...fieldErrors, [f.name]: "" });
                  }}
                  options={f.options || []}
                  autoFocus={index === 0}
                />
              ) : f.kind === "file" ? (
                <U.Input
                  key={fileInputKey}
                  id={`field-${f.name}`}
                  type="file"
                  required={f.required}
                  accept=".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.zip"
                  multiple={f.multiple}
                  autoFocus={index === 0}
                  onChange={(e) => {
                    setFiles(Array.from(e.target.files || []));
                    setError("");
                  }}
                />
              ) : f.kind === "textarea" ? (
                <AutoTextarea
                  id={`field-${f.name}`}
                  required={f.required}
                  rows={4}
                  value={values[f.name]}
                  autoFocus={index === 0}
                  onChange={(e) => {
                    setValues({ ...values, [f.name]: e.target.value });
                    setError("");
                    setFieldErrors({ ...fieldErrors, [f.name]: "" });
                  }}
                />
              ) : (
                <U.Input
                  id={`field-${f.name}`}
                  required={f.required}
                  value={values[f.name]}
                  disabled={files.length > 1 && f.name === "title"}
                  autoFocus={index === 0}
                  aria-invalid={!!fieldErrors[f.name]}
                  aria-describedby={
                    fieldErrors[f.name] ? `field-${f.name}-error` : undefined
                  }
                  onChange={(e) => {
                    setValues({ ...values, [f.name]: e.target.value });
                    setError("");
                    setFieldErrors({ ...fieldErrors, [f.name]: "" });
                  }}
                />
              )}{" "}
              {fieldErrors[f.name] && (
                <p
                  id={`field-${f.name}-error`}
                  role="alert"
                  className="text-p5 text-destructive"
                >
                  {fieldErrors[f.name]}
                </p>
              )}
              {f.hint && (
                <p className="text-p5 text-muted-foreground">{f.hint}</p>
              )}
              {f.kind === "file" && files.length > 1 && (
                <p className="text-p5 text-muted-foreground">
                  {files.length} files selected
                </p>
              )}
              {f.name === "title" && files.length > 1 && (
                <p className="text-p5 text-muted-foreground">
                  Titles come from the file names when several files are
                  selected.
                </p>
              )}
            </div>
          ))}
          {render?.(values)}
          {error && (
            <U.Alert role="alert" variant="destructive">
              <U.AlertDescription>{error}</U.AlertDescription>
            </U.Alert>
          )}
          <U.DialogFooter>
            <U.Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={closeGuard.requestClose}
            >
              Cancel
            </U.Button>
            <U.Button type="submit" variant={submitVariant} disabled={busy}>
              {busy ? activeBusyLabel : submitLabel}
            </U.Button>
          </U.DialogFooter>
        </form>
      </U.DialogContent>
      {closeGuard.confirmation}
    </U.Dialog>
  );
}
export function App({
  accountControl,
  preview = false,
}: {
  accountControl?: ReactNode;
  preview?: boolean;
}) {
  const [data, setData] = useState<Data>();
  const [session, setSession] = useState<
    Session & { providers: Record<string, boolean> }
  >();
  const [error, setError] = useState("");
  const [route, setRoute] = useState(currentRoute);
  const [modal, setModal] = useState<Modal>();
  const [evidence, setEvidence] = useState<Finding>();
  const [source, setSource] = useState<Source>();
  const [sectionData, setSectionData] = useState<SectionsResponse>();
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [sectionsError, setSectionsError] = useState("");
  const [matcher, setMatcher] = useState<Role>();
  const [cancelling, setCancelling] = useState<ResearchJob>();
  const [busy, setBusy] = useState(false);
  // The path decides the page; the query string holds the view state (role
  // scope, search, filters) so Back restores it and a view can be linked to.
  const [path, query] = splitRoute(route);
  const nav = (to: string, params?: Record<string, string | undefined>) => {
    location.hash = href(to, params);
  };
  // View-state changes replace the current history entry: typing in a search
  // box should not create a Back stop per keystroke.
  const replaceQuery = (next: URLSearchParams) => {
    const s = next.toString();
    const hash = `#${path}${s ? `?${s}` : ""}`;
    history.replaceState(history.state, "", hash);
    setRoute(hash.slice(1));
  };
  const setParam = (key: string, value: string, fallback = "") => {
    const next = new URLSearchParams(query);
    if (!value || value === fallback) next.delete(key);
    else next.set(key, value);
    replaceQuery(next);
  };
  const search = query.get("q") || "";
  const setSearch = (v: string) => setParam("q", v);
  const filter = query.get("status") || "all";
  const setFilter = (v: string) => setParam("status", v, "all");
  const requestedRole = query.get("role") || "all";
  const setRoleId = (v: string) => setParam("role", v, "all");
  const evidenceMode = ["findings", "folder"].includes(query.get("view") || "")
    ? query.get("view")!
    : "sections";
  const setEvidenceMode = (v: string) => setParam("view", v, "sections");
  const sectionFilter = (query.get("section") || "all") as Section | "all";
  const setSectionFilter = (v: string) => setParam("section", v, "all");
  const tierFilter = query.get("tier") || "all";
  const sourceFilter = query.get("source") || "all";
  const runFilter = query.get("run") || "all";
  // Clears the search and status filter but keeps the role scope, which is a
  // deliberate choice of view rather than a filter.
  const clearFilters = () => {
    const next = new URLSearchParams(query);
    for (const k of ["q", "status", "section", "tier", "source", "run"])
      next.delete(k);
    replaceQuery(next);
  };
  const unauthorised = useRef(0);
  // The workspace tag of the copy on screen. A poll that comes back with the
  // same tag changes nothing, so nothing is re-rendered.
  const shownTag = useRef<string | null>(null);
  // Whether a research run is in progress, read by the poll timer, and the
  // timer's own re-arm so a change of pace applies at once.
  const running = useRef(false);
  const reschedule = useRef<(() => void) | undefined>(undefined);
  // Reloads overlap (a poll, a tab coming back, a save). Only the most
  // recently started one may change the screen: an earlier one finishing
  // last would put an older copy back.
  const reloads = useRef(0);
  const reload = async () => {
    const started = ++reloads.current;
    const [s, w] = await Promise.all([
      api("/session"),
      apiTagged<Data>("/workspace"),
    ]);
    if (started !== reloads.current) return;
    unauthorised.current = 0;
    setSession((prev) =>
      JSON.stringify(prev) === JSON.stringify(s) ? prev : s,
    );
    if (!w.etag || w.etag !== shownTag.current) {
      shownTag.current = w.etag;
      setData(w.data);
    }
    setError("");
  };
  // Background refreshes fail now and then (a tab left in the background, a
  // brief network drop, a server restart). Report that without discarding the
  // workspace already on screen; the next refresh clears it. Access failures
  // are different: a 403 means membership was withdrawn, and a 401 that
  // survives a session renewal and a further poll means the sign-in is gone,
  // so the workspace leaves the screen.
  const failed = (e: unknown) => {
    const status = e instanceof ApiError ? e.status : undefined;
    if (status === 401) unauthorised.current += 1;
    if (status === 403 || (status === 401 && unauthorised.current >= 2)) {
      shownTag.current = null;
      setData(undefined);
      setSession(undefined);
    }
    setError(
      status === 401
        ? "Your sign-in could not be confirmed. Sign out and sign in again."
        : (e as Error).message,
    );
  };
  useEffect(() => {
    const hash = () => {
      setRoute(currentRoute());
      // Dialogs and panels belong to the page that opened them. Back, or a
      // typed address, must not leave one open over a different page whose
      // organisation may no longer be on screen.
      setModal(undefined);
      setCancelling(undefined);
      setEvidence(undefined);
      setSource(undefined);
      setMatcher(undefined);
    };
    window.addEventListener("hashchange", hash);
    void reload().catch(failed);
    // Hidden tabs do not poll: browsers throttle their timers and let the
    // session cookie lapse, and nobody is looking. Refresh on return instead.
    // While a research run is in progress the poll is quick so its stages
    // show as they happen; otherwise it only picks up teammates' changes.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped)
        timer = setTimeout(tick, running.current ? POLL_ACTIVE : POLL_IDLE);
    };
    reschedule.current = schedule;
    const tick = async () => {
      if (!document.hidden) await reload().catch(failed);
      schedule();
    };
    const woke = () => {
      if (!document.hidden) void tick();
    };
    schedule();
    document.addEventListener("visibilitychange", woke);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("hashchange", hash);
      document.removeEventListener("visibilitychange", woke);
    };
  }, []);
  const anyRunning = !!data?.jobs.some((j) =>
    ["queued", "researching"].includes(j.status),
  );
  useEffect(() => {
    if (running.current === anyRunning) return;
    running.current = anyRunning;
    reschedule.current?.();
  }, [anyRunning]);
  const run = async (
    fn: () => Promise<unknown>,
    message = "Saved",
    options?: {
      afterReload?: () => Promise<unknown>;
      rethrow?: boolean;
    },
  ) => {
    setBusy(true);
    try {
      await runWorkspaceAction(fn, reload, options?.afterReload);
      U.toast({ title: message });
    } catch (e) {
      U.toast({
        title: "Could not complete the action",
        description: (e as Error).message,
        variant: "destructive",
      });
      if (options?.rethrow) throw e;
    } finally {
      setBusy(false);
    }
  };
  const parts = path.split("/").filter(Boolean);
  const org = data?.organisations.find((o) => o.id === parts[1]);
  // Whether the organisation heading has scrolled out of view (phones show
  // a compact stand-in beside the tabs then).
  const header = useScrolledPast<HTMLDivElement>(org?.id);
  const tab = TABS.some(([id]) => id === parts[2]) ? parts[2] : "overview";
  const tabName = TABS.find(([id]) => id === tab)![1];
  const orgRoles = data?.roles.filter((r) => r.orgId === org?.id) || [];
  // A role scope naming a removed role falls back to the whole organisation.
  const roleId = orgRoles.some((r) => r.id === requestedRole)
    ? requestedRole
    : "all";
  useEffect(() => {
    if (!org) {
      setSectionData(undefined);
      setSectionsError("");
      setSectionsLoading(false);
      return;
    }
    let live = true;
    setSectionData(undefined);
    setSectionsError("");
    setSectionsLoading(true);
    api<SectionsResponse>(
      `/orgs/${org.id}/sections${roleId === "all" ? "" : `?roleId=${encodeURIComponent(roleId)}`}`,
    )
      .then((result) => {
        if (live) setSectionData(result);
      })
      .catch((caught) => {
        if (live) setSectionsError((caught as Error).message);
      })
      .finally(() => {
        if (live) setSectionsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [org?.id, roleId, data]);
  useEffect(() => {
    if (
      evidenceMode !== "folder" ||
      sectionsLoading ||
      sectionsError ||
      !sectionData
    )
      return;
    if (
      sectionFilter === "all" ||
      !validFolderSection(sectionFilter, sectionData.sections)
    ) {
      const next = new URLSearchParams(query);
      next.delete("view");
      next.delete("section");
      replaceQuery(next);
    }
  }, [
    evidenceMode,
    sectionFilter,
    sectionsLoading,
    sectionsError,
    sectionData,
  ]);
  // ...and the address is corrected to match, so a copied link or Back does
  // not carry a scope that is not the one shown.
  useEffect(() => {
    if (data && org && requestedRole !== "all" && roleId === "all")
      setParam("role", "");
  }, [!data, org?.id, requestedRole, roleId]);
  // Links that keep the current role scope.
  const orgHref = (
    nextTab: string,
    params?: Record<string, string | undefined>,
  ) =>
    href(`/org/${org?.id}/${nextTab}`, {
      role: roleId === "all" ? undefined : roleId,
      ...params,
    });
  const orgJobs = data?.jobs.filter((j) => j.orgId === org?.id) || [];
  const activeJobs = orgJobs.filter(isActive);
  useEffect(() => {
    const page =
      path === "/settings"
        ? "Team & settings"
        : !data
          ? ""
          : org
            ? tab === "overview"
              ? org.name
              : `${org.name} · ${tabName}`
            : parts[0] === "org"
              ? "Organisation not found"
              : "Organisations";
    document.title = page
      ? `${page} · Organisation Research`
      : "Organisation Research · Springpod";
  }, [path, tab, org?.name, !data]);
  const relevant = (x: { orgId: string; roleId?: string }) =>
    x.orgId === org?.id &&
    (roleId === "all" || !x.roleId || x.roleId === roleId);
  const findings = data?.findings.filter(relevant) || [];
  const questions = data?.questions.filter(relevant) || [];
  const sources =
    data?.sources.filter(
      (s) =>
        s.orgId === org?.id &&
        (roleId === "all" || !s.roleIds.length || s.roleIds.includes(roleId)),
    ) || [];
  const organisationSources =
    data?.sources.filter((source) => source.orgId === org?.id) || [];
  const packs =
    data?.packs.filter(
      (p) =>
        p.organisation.id === org?.id &&
        (roleId === "all" || p.role.id === roleId),
    ) || [];
  // Run history is shown for the whole organisation, newest first.
  const runs = [...orgJobs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const roleOptions: [string, string][] = [
    ["all", "All roles"],
    ...orgRoles.map((r) => [r.id, r.title] as [string, string]),
  ];
  const orgState = (o: Organisation) =>
    data?.jobs.some(
      (j) => j.orgId === o.id && ["queued", "researching"].includes(j.status),
    )
      ? "researching"
      : data?.findings.some(
            (f) =>
              f.orgId === o.id &&
              ["unreviewed", "clarification"].includes(f.review),
          )
        ? "unreviewed"
        : data?.packs.some(
              (p) => p.organisation.id === o.id && p.status === "ready",
            )
          ? "ready"
          : "draft";
  // Creating an organisation asks only for its identity; division, summary
  // and brand notes are added later through "Edit organisation".
  const orgFields = (o?: Organisation): Field[] => [
    {
      name: "name",
      label: "Organisation name",
      value: o?.name,
      required: true,
    },
    {
      name: "website",
      label: "Organisation website",
      value: o?.website,
      validateUrl: true,
      hint: "Confirm the correct company website. Leave blank if it is unknown.",
    },
    {
      name: "country",
      label: "Country",
      value: o?.country || "United Kingdom",
      required: true,
    },
    ...(o
      ? ([
          {
            name: "division",
            label: "The entity the learner meets",
            value: o.division,
          },
          {
            name: "summary",
            label: "Organisation summary",
            value: o.summary,
            kind: "textarea",
            hint: "A working summary. Evidence-backed claims about the organisation are recorded separately.",
          },
          {
            name: "brandNotes",
            label: "Brand",
            value: o.brandNotes,
            kind: "textarea",
          },
          {
            name: "factCheckerStatus",
            label: "Who at the organisation checks facts",
            value:
              o.factChecker &&
              o.factChecker.name.trim().toLowerCase() !== "not yet known"
                ? "named"
                : "unknown",
            kind: "select",
            options: [
              ["unknown", "Not yet known"],
              ["named", "Named contact"],
            ],
          },
          {
            name: "factCheckerName",
            label: "Fact checker — name",
            value: o.factChecker?.name,
            hint: "Leave both fields blank if this is not yet known.",
          },
          {
            name: "factCheckerJobTitle",
            label: "Who at the organisation checks facts — job title",
            value: o.factChecker?.jobTitle,
          },
          {
            name: "brandGuidelines",
            label: "Brand guidelines and where they live",
            value: o.brand?.guidelines,
            kind: "textarea",
          },
          {
            name: "brandLogo",
            label: "Logo rules",
            value: o.brand?.logo,
            kind: "textarea",
          },
          {
            name: "brandPhotography",
            label: "Photography",
            value: o.brand?.photography,
            kind: "textarea",
          },
          {
            name: "brandHouseStyle",
            label: "House style",
            value: o.brand?.houseStyle,
            kind: "textarea",
          },
          ...(["mayUse", "mustNotSay"] as const).flatMap((key) => {
            const items = [...(o[key] || []), { text: "", sourceId: "none" }];
            const heading =
              key === "mayUse" ? "Names we may use" : "Things we must not say";
            return items.flatMap((item, index): Field[] => [
              {
                name: `${key}Text${index}`,
                label: index === 0 ? heading : `${heading} — item ${index + 1}`,
                value: item.text,
                hint:
                  index === items.length - 1
                    ? "Use the final empty row to add another item."
                    : undefined,
              },
              {
                name: `${key}Source${index}`,
                label: `Tier-1 source for item ${index + 1}`,
                value: item.sourceId || "none",
                kind: "select",
                options: [
                  ["none", "Not selected"],
                  ...organisationSources
                    .filter((source) => source.tier === 1)
                    .map(
                      (source) => [source.id, source.title] as [string, string],
                    ),
                ],
              },
            ]);
          }),
        ] satisfies Field[])
      : []),
  ];
  // Adding a role asks only for the essentials; seniority and decision-making
  // boundaries are captured later through "Edit role".
  const roleFields = (r?: Role): Field[] => [
    { name: "title", label: "Job title", value: r?.title, required: true },
    { name: "location", label: "Workplace or location", value: r?.location },
    ...(r
      ? [{ name: "seniority", label: "Seniority", value: r.seniority }]
      : []),
    {
      name: "responsibilities",
      label: "Responsibilities",
      value: r?.responsibilities,
      kind: "textarea",
      required: true,
    },
    ...(r
      ? ([
          {
            name: "boundaries",
            label: "Decision-making boundaries",
            value: r.boundaries,
            kind: "textarea",
            hint: "What can this person decide, and when must they ask for help?",
          },
          {
            name: "standardName",
            label: "Apprenticeship standard — name",
            value: r.standard?.name,
          },
          {
            name: "standardLevel",
            label: "Apprenticeship standard — level",
            value: r.standard?.level,
          },
          {
            name: "standardDuration",
            label: "Apprenticeship standard — duration",
            value: r.standard?.duration,
          },
          {
            name: "standardUrl",
            label: "Apprenticeship standard — URL",
            value: r.standard?.url,
            validateUrl: true,
          },
          {
            name: "assessmentPlanUrl",
            label: "Assessment plan URL",
            value: r.standard?.assessmentPlanUrl,
            validateUrl: true,
          },
          {
            name: "ncsUrl",
            label: "National Careers Service profile URL",
            value: r.ncsUrl,
            validateUrl: true,
          },
          {
            name: "bodyName",
            label: "Professional body — name",
            value: r.professionalBody?.name,
          },
          {
            name: "registrationRoute",
            label: "Professional body — registration route",
            value: r.professionalBody?.registrationRoute,
          },
          {
            name: "frameworkUrl",
            label: "Professional body — framework URL",
            value: r.professionalBody?.frameworkUrl,
            validateUrl: true,
          },
          {
            name: "interviewWho",
            label: "Interview — who",
            value: r.interview?.who,
          },
          {
            name: "interviewJobTitle",
            label: "Interview — job title",
            value: r.interview?.jobTitle,
          },
          {
            name: "timeInRole",
            label: "Interview — time in role",
            value: r.interview?.timeInRole,
          },
          {
            name: "mayBeNamed",
            label: "Interview — may be named",
            value: r.interview?.mayBeNamed ? "true" : "false",
            kind: "select",
            options: [
              ["false", "No"],
              ["true", "Yes"],
            ],
          },
          {
            name: "interviewDate",
            label: "Interview — date",
            value: r.interview?.date,
          },
          {
            name: "interviewHow",
            label: "Interview — how it took place",
            value: r.interview?.how,
          },
          {
            name: "recordingSourceId",
            label: "Interview — recording source",
            value: r.interview?.recordingSourceId || "none",
            kind: "select",
            options: [
              ["none", "Not selected"],
              ...organisationSources.map(
                (source) => [source.id, source.title] as [string, string],
              ),
            ],
          },
          {
            name: "transcriptSourceId",
            label: "Interview — transcript source",
            value: r.interview?.transcriptSourceId || "none",
            kind: "select",
            options: [
              ["none", "Not selected"],
              ...organisationSources.map(
                (source) => [source.id, source.title] as [string, string],
              ),
            ],
          },
        ] satisfies Field[])
      : []),
  ];
  const scopeField: Field = {
    name: "roleId",
    label: "Role scope",
    value: roleId,
    kind: "select",
    options: roleOptions,
  };
  function renderModal() {
    if (!modal) return null;
    const close = () => setModal(undefined);
    // Every dialog confirms its save the same way once the workspace has
    // refreshed; the dialog itself shows any error and stays open.
    const save = async (fn: () => Promise<unknown>, message: string) => {
      await fn();
      await reload();
      U.toast({ title: message });
    };
    const m = modal.item;
    if (modal.type === "organisation")
      return (
        <FormModal
          title={m ? "Edit organisation" : "Create organisation"}
          description="Confirm the organisation’s identity. Existing organisations are checked before a new record is created."
          fields={orgFields(m)}
          onClose={close}
          submitLabel={m ? "Save changes" : "Create organisation"}
          render={
            m
              ? undefined
              : (v) => (
                  <OrgSuggestions
                    name={v.name || ""}
                    website={v.website || ""}
                    onOpen={(id) => {
                      close();
                      nav(`/org/${id}/overview`);
                    }}
                  />
                )
          }
          onSubmit={async (v) => {
            const {
              factCheckerStatus,
              factCheckerName,
              factCheckerJobTitle,
              brandGuidelines,
              brandLogo,
              brandPhotography,
              brandHouseStyle,
              ...base
            } = v;
            const attributed = (key: "mayUse" | "mustNotSay") =>
              Object.keys(v)
                .filter((name) => name.startsWith(`${key}Text`))
                .sort(
                  (a, b) =>
                    Number(a.slice(`${key}Text`.length)) -
                    Number(b.slice(`${key}Text`.length)),
                )
                .map((name) => {
                  const index = name.slice(`${key}Text`.length);
                  return {
                    text: v[name].trim(),
                    sourceId: v[`${key}Source${index}`],
                  };
                })
                .filter((item) => item.text);
            const cleanBase = Object.fromEntries(
              Object.entries(base).filter(
                ([name]) => !/^(mayUse|mustNotSay)(Text|Source)\d+$/.test(name),
              ),
            );
            const organisationValues = m
              ? {
                  ...cleanBase,
                  factChecker:
                    factCheckerStatus === "named"
                      ? { name: factCheckerName, jobTitle: factCheckerJobTitle }
                      : { name: "not yet known", jobTitle: "" },
                  brand: {
                    guidelines: brandGuidelines,
                    logo: brandLogo,
                    photography: brandPhotography,
                    houseStyle: brandHouseStyle,
                  },
                  mayUse: attributed("mayUse"),
                  mustNotSay: attributed("mustNotSay"),
                }
              : base;
            const created = m
              ? await patch(`/organisations/${m.id}`, {
                  ...organisationValues,
                  version: m.version,
                })
              : await post("/organisations", organisationValues);
            await reload();
            U.toast({
              title: m ? "Organisation updated" : "Organisation created",
            });
            nav(`/org/${created.id}/overview`);
          }}
        />
      );
    if (modal.type === "role")
      return (
        <FormModal
          title={m ? "Edit role" : "Add a role"}
          description="Keep the organisation’s own job title. Describe the work so occupational matches can be checked."
          fields={roleFields(m)}
          onClose={close}
          onSubmit={async (v) => {
            const {
              standardName,
              standardLevel,
              standardDuration,
              standardUrl,
              assessmentPlanUrl,
              bodyName,
              registrationRoute,
              frameworkUrl,
              interviewWho,
              interviewJobTitle,
              timeInRole,
              mayBeNamed,
              interviewDate,
              interviewHow,
              recordingSourceId,
              transcriptSourceId,
              ...base
            } = v;
            const roleValues = m
              ? {
                  ...base,
                  standard: standardName.trim()
                    ? {
                        name: standardName,
                        level: standardLevel,
                        duration: standardDuration,
                        url: standardUrl,
                        assessmentPlanUrl,
                      }
                    : null,
                  professionalBody: bodyName.trim()
                    ? { name: bodyName, registrationRoute, frameworkUrl }
                    : null,
                  interview: interviewWho.trim()
                    ? {
                        who: interviewWho,
                        jobTitle: interviewJobTitle,
                        timeInRole,
                        mayBeNamed: mayBeNamed === "true",
                        date: interviewDate,
                        how: interviewHow,
                        recordingSourceId:
                          recordingSourceId === "none"
                            ? undefined
                            : recordingSourceId,
                        transcriptSourceId:
                          transcriptSourceId === "none"
                            ? undefined
                            : transcriptSourceId,
                      }
                    : null,
                }
              : base;
            return save(
              () =>
                m
                  ? patch(`/roles/${m.id}`, {
                      ...roleValues,
                      version: m.version,
                    })
                  : post(`/organisations/${org!.id}/roles`, roleValues),
              m ? "Role updated" : "Role added",
            );
          }}
        />
      );
    if (modal.type === "delete-role") {
      const r = m as Role;
      const count = (items: { roleId?: string }[]) =>
        items.filter((x) => x.roleId === r.id).length;
      const impact = {
        findings: count(data?.findings || []),
        questions: count(data?.questions || []),
        activities: count(data?.activities || []),
        jobs: count(data?.jobs || []),
        sources: (data?.sources || []).filter((s) => s.roleIds.includes(r.id))
          .length,
        packs: (data?.packs || []).filter((p) => p.role.id === r.id).length,
      };
      const running = (data?.jobs || []).some(
        (j) =>
          j.roleId === r.id && ["queued", "researching"].includes(j.status),
      );
      const blocked = impact.packs > 0 || running;
      return (
        <FormModal
          title="Delete this role?"
          description={`${r.title} will be removed from ${org!.name}. This cannot be undone.`}
          fields={[]}
          submitLabel={blocked ? "Cannot delete" : "Delete role"}
          submitVariant="destructive"
          onClose={close}
          render={() => (
            <div className="space-y-4">
              {impact.packs > 0 && (
                <U.Alert>
                  <U.AlertDescription>
                    This role has {impact.packs} research pack
                    {impact.packs === 1 ? "" : "s"}. Packs are immutable
                    records, so a role that has been exported cannot be deleted.
                  </U.AlertDescription>
                </U.Alert>
              )}
              {running && (
                <U.Alert>
                  <U.AlertDescription>
                    A research run is in progress for this role. Cancel it under
                    Research runs on the Overview tab before deleting the role.
                  </U.AlertDescription>
                </U.Alert>
              )}
              <ul className="text-p4 list-disc pl-5 space-y-1">
                <li>
                  {impact.findings} fact{impact.findings === 1 ? "" : "s"}{" "}
                  scoped to this role will be deleted, with{" "}
                  {impact.findings === 1 ? "its" : "their"} review history.
                </li>
                <li>
                  {impact.questions} question
                  {impact.questions === 1 ? "" : "s"}
                  {impact.activities > 0 &&
                    `, ${impact.activities} ${impact.activities === 1 ? "activity" : "activities"}`}{" "}
                  and {impact.jobs} research run{impact.jobs === 1 ? "" : "s"}{" "}
                  for this role will be deleted.
                </li>
                <li>
                  Organisation-wide facts and questions are not affected.
                  Sources stay with the organisation
                  {impact.sources > 0 &&
                    ` (${impact.sources} will no longer be linked to this role)`}
                  .
                </li>
              </ul>
              <p className="text-p5 text-muted-foreground">
                The deletion is recorded in the audit log.
              </p>
            </div>
          )}
          onSubmit={async () => {
            if (blocked)
              throw new Error(
                impact.packs > 0
                  ? "A role with research packs cannot be deleted."
                  : "Cancel the research run before deleting the role.",
              );
            await del(`/roles/${r.id}`, { version: r.version });
            if (roleId === r.id) setRoleId("all");
            await reload();
            U.toast({ title: "Role deleted" });
          }}
        />
      );
    }
    if (modal.type === "statement")
      return (
        <FormModal
          title="Add source material"
          description="Record a source passage or a statement from the organisation. The original wording stays inspectable."
          fields={[
            { name: "title", label: "Source title", required: true },
            {
              name: "kind",
              label: "Source type",
              value: "statement",
              kind: "select",
              options: [
                ["statement", "Statement from the organisation or team"],
                ["document", "Document excerpt"],
                ["occupation", "Occupational reference"],
                ["film", "Film"],
                ["advert", "Job advert"],
                ["screenshot", "Screenshot"],
                ["standard", "Apprenticeship standard"],
                ["guidance", "Professional guidance"],
              ],
            },
            {
              name: "text",
              label: "Source passage",
              required: true,
              kind: "textarea",
            },
            { name: "url", label: "Source URL (optional)" },
            {
              name: "suppliedBy",
              label: "Source or contributor name",
              required: true,
            },
            {
              name: "verification",
              label: "Verification basis",
              value: "user-supplied",
              kind: "select",
              options: [
                ["user-supplied", "Team-supplied information"],
                ["client-confirmed", "Confirmed by the organisation"],
                ["public-source", "Public source"],
              ],
            },
            {
              name: "providedByName",
              label: "Organisation contact name (if confirmed)",
            },
            {
              name: "providedByJobTitle",
              label: "Organisation contact job title (if confirmed)",
            },
            {
              name: "rights",
              label: "Media rights",
              value: "none",
              kind: "select",
              options: [
                ["none", "Not applicable or not recorded"],
                ["organisation-supplied", "Supplied by the organisation"],
                ["press-kit", "Press kit"],
                ["reference-only", "Reference only"],
              ],
            },
            {
              name: "folder",
              label: "Section",
              value: m?.folder || "auto",
              kind: "select",
              options: FOLDER_OPTIONS,
            },
            { name: "locator", label: "Page, section or meeting reference" },
            scopeField,
          ]}
          onClose={close}
          onSubmit={async (v) =>
            save(
              () =>
                post(`/organisations/${org!.id}/sources`, {
                  title: v.title,
                  kind: v.kind,
                  text: v.text,
                  url: v.url,
                  suppliedBy: v.suppliedBy,
                  verification: v.verification,
                  locator: v.locator,
                  roleIds: v.roleId === "all" ? [] : [v.roleId],
                  folder: v.folder === "auto" ? undefined : v.folder,
                  rights: v.rights === "none" ? undefined : v.rights,
                  providedBy:
                    v.verification === "client-confirmed" &&
                    v.providedByName.trim()
                      ? {
                          name: v.providedByName,
                          jobTitle: v.providedByJobTitle,
                        }
                      : undefined,
                }),
              "Source recorded",
            )
          }
        />
      );
    if (modal.type === "web")
      return (
        <FormModal
          title="Capture a public source"
          description="The page is fetched and stored as a dated research excerpt. Private network addresses are blocked."
          fields={[
            {
              name: "url",
              label: "Public page URL",
              required: true,
              validateUrl: true,
            },
            {
              name: "folder",
              label: "Section",
              value: m?.folder || "auto",
              kind: "select",
              options: FOLDER_OPTIONS,
            },
            scopeField,
          ]}
          onClose={close}
          submitLabel="Capture source"
          onSubmit={async (v) =>
            save(
              () =>
                post(`/organisations/${org!.id}/web-source`, {
                  url: v.url,
                  roleId: v.roleId === "all" ? undefined : v.roleId,
                  folder: v.folder === "auto" ? undefined : v.folder,
                }),
              "Page captured",
            )
          }
        />
      );
    if (modal.type === "upload")
      return (
        <FormModal
          title="Upload source material"
          description="PDF, DOCX, TXT, Markdown, PNG or JPEG up to 10 MB, or a ZIP of PNG/JPEG images up to 100 MB (200 images at most). Uploaded assets start with unconfirmed usage permission."
          fields={[
            { name: "title", label: "Title (optional)" },
            {
              name: "file",
              label: "Document or workplace image",
              kind: "file",
              required: true,
              multiple: true,
            },
            {
              name: "caption",
              label: "Context or image caption",
              kind: "textarea",
              hint: "For photos, describe the location, relevant role and anything the image cannot establish.",
            },
            {
              name: "verification",
              label: "Verification basis",
              value: "user-supplied",
              kind: "select",
              options: [
                ["user-supplied", "Team-supplied information"],
                ["client-confirmed", "Confirmed by the organisation"],
                ["public-source", "Public source"],
              ],
            },
            {
              name: "providedByName",
              label: "Organisation contact name (if confirmed)",
            },
            {
              name: "providedByJobTitle",
              label: "Organisation contact job title (if confirmed)",
            },
            {
              name: "rights",
              label: "Image or film rights",
              value: "none",
              kind: "select",
              options: [
                ["none", "Not recorded"],
                ["organisation-supplied", "Supplied by the organisation"],
                ["press-kit", "Press kit"],
                ["reference-only", "Reference only"],
              ],
            },
            {
              name: "folder",
              label: "Section",
              value: m?.folder || "auto",
              kind: "select",
              options: FOLDER_OPTIONS,
            },
            scopeField,
          ]}
          onClose={close}
          submitLabel="Upload"
          busyLabel={(file) =>
            file?.name.toLowerCase().endsWith(".zip")
              ? "Importing images…"
              : "Uploading…"
          }
          onSubmit={async (v, file, context) => {
            const files = context?.files || (file ? [file] : []);
            if (!files.length) throw new Error("Choose a file.");
            type ZipResult = {
              imported: number;
              sources: Source[];
              skipped: Array<{
                name: string;
                reason: "not-image" | "duplicate";
              }>;
            };
            let position = 0;
            let singleResult: Source | ZipResult | undefined;
            let zipImported = 0;
            let zipSkipped = 0;
            const result = await uploadFiles<Source>(
              files,
              v,
              async (current, meta) => {
                position++;
                if (files.length > 1)
                  context?.setBusyLabel(
                    `Uploading ${position} of ${files.length}…`,
                  );
                const form = new FormData();
                form.append("file", current);
                form.append("title", meta.title);
                form.append("caption", meta.caption);
                if (meta.folder !== "auto") form.append("folder", meta.folder);
                if (meta.rights !== "none") form.append("rights", meta.rights);
                if (meta.tier) form.append("tier", meta.tier);
                if (meta.tierReason) form.append("tierReason", meta.tierReason);
                if (
                  meta.verification === "client-confirmed" &&
                  meta.providedByName.trim()
                ) {
                  form.append(
                    "providedBy",
                    JSON.stringify({
                      name: meta.providedByName,
                      jobTitle: meta.providedByJobTitle,
                    }),
                  );
                }
                if (meta.roleId !== "all") form.append("roleId", meta.roleId);
                const response = await api<Source | ZipResult>(
                  `/organisations/${org!.id}/upload`,
                  {
                    method: "POST",
                    body: form,
                  },
                );
                if (files.length === 1) singleResult = response;
                if ("imported" in response) {
                  zipImported += response.imported;
                  zipSkipped += response.skipped.length;
                }
                return response;
              },
            );
            await reload();
            const successfulFiles = files.length - result.failed.length;
            const zipSummary =
              zipImported || zipSkipped
                ? `${zipImported} ZIP images imported${zipSkipped ? ` · ${zipSkipped} skipped` : ""}`
                : undefined;
            if (result.failed.length) {
              context?.clearFiles();
              if (successfulFiles)
                U.toast({
                  title: `Uploaded ${successfulFiles} ${successfulFiles === 1 ? "file" : "files"}`,
                  description: zipSummary,
                });
              throw new Error(
                result.failed
                  .map((failure) => `${failure.name} — ${failure.message}`)
                  .join("; "),
              );
            }
            if (files.length > 1) {
              U.toast({
                title: `Uploaded ${files.length} files`,
                description: zipSummary,
              });
              return;
            }
            if (!singleResult || !("imported" in singleResult)) {
              U.toast({ title: "File uploaded" });
              return;
            }
            const skipped = singleResult.skipped || [];
            const details = skipped
              .slice(0, 5)
              .map(
                (item) =>
                  `${item.name} (${item.reason === "duplicate" ? "duplicate" : "not an image"})`,
              );
            if (skipped.length > 5)
              details.push(`and ${skipped.length - 5} more`);
            U.toast({
              title: `Imported ${singleResult.imported} images${skipped.length ? ` · ${skipped.length} files skipped` : ""}`,
              description: details.length ? details.join(", ") : undefined,
            });
          }}
        />
      );
    if (modal.type === "note") {
      const noteSection = sharedSections.find(
        (section) => section.folder === m.folder,
      )!;
      return (
        <NoteForm
          folder={m.folder}
          roleScoped={noteSection.roleScoped}
          roleId={roleId === "all" ? undefined : roleId}
          roleOptions={roleOptions.filter(([id]) => id !== "all")}
          onClose={close}
          onSubmit={async (value) => {
            await save(
              () =>
                post(`/organisations/${org!.id}/sources`, {
                  ...value,
                  kind: "note",
                  url: "",
                  locator: value.extractedFrom,
                  suppliedBy: session?.name || "",
                  verification: "public-source",
                  roleIds: noteRoleIds(value.folder, value.roleId),
                }),
              "Research note saved",
            );
          }}
        />
      );
    }
    if (modal.type === "finding")
      return (
        <RecordFactDialog
          initialSlot={m?.slot}
          sources={organisationSources}
          roleId={roleId}
          roleOptions={roleOptions}
          onClose={close}
          onSubmit={async (value) => {
            await save(
              () => post(`/organisations/${org!.id}/findings`, value),
              "Fact recorded",
            );
          }}
        />
      );
    if (modal.type === "question")
      return (
        <FormModal
          title={
            m ? "Respond to question" : "Add a question for the organisation"
          }
          description="An answer does not automatically verify a fact. Record its source and review affected facts separately."
          fields={
            m
              ? [
                  {
                    name: "status",
                    label: "Status",
                    kind: "select",
                    value: m.status,
                    options: [
                      ["open", "Open"],
                      ["client", "Ask the organisation"],
                      ["deferred", "Defer"],
                      ["answered", "Answered"],
                    ],
                  },
                  {
                    name: "answer",
                    label: "Answer",
                    kind: "textarea",
                    value: m.answer,
                  },
                  {
                    name: "provenance",
                    label: "Who or what supplied the answer?",
                    value: m.provenance,
                  },
                  { name: "assignee", label: "Assigned to", value: m.assignee },
                ]
              : [
                  {
                    name: "text",
                    label: "Question",
                    kind: "textarea",
                    required: true,
                  },
                  {
                    name: "why",
                    label: "Why this matters",
                    kind: "textarea",
                    required: true,
                  },
                  {
                    name: "blocking",
                    label: "Does this block storyboard drafting?",
                    value: "false",
                    kind: "select",
                    options: [
                      ["false", "No — carry into the organisation's review"],
                      ["true", "Yes — identity or scope must be resolved"],
                    ],
                  },
                  { name: "assignee", label: "Assigned to" },
                  scopeField,
                ]
          }
          onClose={close}
          onSubmit={async (v) =>
            save(
              () =>
                m
                  ? patch(`/questions/${m.id}`, { ...v, version: m.version })
                  : post(`/organisations/${org!.id}/questions`, {
                      ...v,
                      blocking: v.blocking === "true",
                      roleId: v.roleId === "all" ? undefined : v.roleId,
                    }),
              m ? "Question updated" : "Question added",
            )
          }
        />
      );
    if (modal.type === "question-fact")
      return (
        <QuestionFactDialog
          question={m}
          onClose={close}
          onSaved={async () => {
            await reload();
            U.toast({ title: "Fact created from the answer" });
          }}
        />
      );
    if (modal.type === "occupation")
      return (
        <FormModal
          title="Record an occupational match"
          description="Use an actual dataset record. UK SOC and O*NET codes are separate systems; no automatic equivalence is assumed."
          fields={[
            {
              name: "scheme",
              label: "Classification",
              value: "UK SOC",
              kind: "select",
              options: [
                ["UK SOC", "UK SOC"],
                ["O*NET", "O*NET (US context)"],
              ],
            },
            { name: "code", label: "Exact occupation code", required: true },
            {
              name: "title",
              label: "Dataset occupation title",
              required: true,
            },
            { name: "sourceUrl", label: "Official source URL", required: true },
            {
              name: "datasetVersion",
              label: "Dataset version",
              required: true,
            },
            {
              name: "rationale",
              label: "Why this matches the role",
              kind: "textarea",
              required: true,
            },
            {
              name: "activities",
              label: "Typical activities (one per line)",
              kind: "textarea",
            },
            {
              name: "skills",
              label: "Skills (one per line)",
              kind: "textarea",
            },
            {
              name: "knowledge",
              label: "Knowledge (one per line)",
              kind: "textarea",
            },
            {
              name: "workContext",
              label: "Work context (one per line)",
              kind: "textarea",
            },
            {
              name: "status",
              label: "Match status",
              value: "proposed",
              kind: "select",
              options: [
                ["proposed", "Proposed — needs review"],
                ["confirmed", "Reviewed match"],
              ],
            },
          ]}
          onClose={close}
          onSubmit={async (v) =>
            save(
              () =>
                post(`/roles/${m.id}/occupations`, {
                  ...v,
                  version: m.version,
                  activities: v.activities.split("\n").filter(Boolean),
                  skills: v.skills.split("\n").filter(Boolean),
                  knowledge: v.knowledge.split("\n").filter(Boolean),
                  workContext: v.workContext.split("\n").filter(Boolean),
                }),
              "Occupational match recorded",
            )
          }
        />
      );
    if (modal.type === "member")
      return (
        <FormModal
          title={m ? "Edit team access" : "Add a team member"}
          description={
            m
              ? `Access to this research workspace only.${m.email ? ` Signed in as ${m.email}.` : ""}`
              : "Enter the work email address the person signs in with. If they have signed in before, access starts now; otherwise it starts the first time they sign in."
          }
          fields={[
            ...(m
              ? []
              : [
                  {
                    name: "email",
                    label: "Work email address",
                    required: true,
                  } satisfies Field,
                ]),
            {
              name: "name",
              label: "Display name",
              value: m?.name,
              required: true,
            },
            {
              name: "role",
              label: "Workspace role",
              value: m?.role || "researcher",
              kind: "select",
              options: [
                ["researcher", "Researcher"],
                ["reviewer", "Reviewer"],
                ["admin", "Administrator"],
              ],
            },
            ...(m
              ? [
                  {
                    name: "active",
                    label: "Access",
                    value: m.active === false ? "false" : "true",
                    kind: "select",
                    options: [
                      ["true", "Active"],
                      ["false", "Revoked"],
                    ],
                  } satisfies Field,
                ]
              : []),
          ]}
          onClose={close}
          onSubmit={async (v) => {
            const result = (await post("/members", {
              ...v,
              ...(m ? { userId: m.userId } : {}),
              active: m ? v.active === "true" : true,
            })) as { invitedAt?: string };
            await reload();
            U.toast({
              title: m
                ? "Team access saved"
                : result.invitedAt
                  ? "Invitation saved"
                  : "Team member added",
              description: result.invitedAt
                ? "Access starts the first time this person signs in with that address."
                : undefined,
            });
          }}
        />
      );
    if (modal.type === "pack")
      return (
        <PackModal
          org={org!}
          roleOptions={roleOptions.filter(([id]) => id !== "all")}
          initialRole={roleId === "all" ? orgRoles[0]?.id : roleId}
          onClose={close}
          onSaved={async () => {
            await reload();
            U.toast({ title: "Research pack created" });
          }}
        />
      );
    if (modal.type === "research")
      return (
        <ResearchDialog
          org={org!}
          roles={orgRoles}
          jobs={data?.jobs || []}
          sources={(data?.sources || []).filter(
            (x) => x.orgId === org!.id && x.text && !x.error,
          )}
          tiers={session?.providers || {}}
          initialRoleId={roleId === "all" ? undefined : roleId}
          initialSection={modal.item?.section}
          initialSourceIds={modal.item?.sourceIds}
          onClose={close}
          onStart={async (tier, scopeRoleId, sections, sourceIds, crawl) => {
            await startResearch(tier, scopeRoleId, sections, sourceIds, crawl);
          }}
        />
      );
    return null;
  }
  const pageHeading = (
    eyebrow: string,
    title: string,
    description: string,
    action?: ReactNode,
  ) => (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between mb-8">
      <div>
        <p className="text-label-3 uppercase text-muted-foreground mb-2">
          {eyebrow}
        </p>
        <h1 className="text-h3-mobile lg:text-h3">{title}</h1>
        <p className="text-p3 text-muted-foreground mt-2 max-w-2xl">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
  const renderDirectory = () => {
    const organisations = (data?.organisations || []).filter(
      (o) =>
        (o.name + " " + o.division + " " + o.country)
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" || orgState(o) === filter),
    );
    return (
      <>
        {pageHeading(
          "Research workspace",
          "Organisations",
          "Build the evidence behind a day in the role.",
          <U.Button onClick={() => setModal({ type: "organisation" })}>
            <U.IconAdd size={20} />
            Create organisation
          </U.Button>,
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            [
              "Organisations",
              data?.organisations.length || 0,
              "Your shared organisation library",
            ],
            [
              "Source attention",
              data?.findings.filter(
                (f) =>
                  f.review === "unreviewed" || f.review === "clarification",
              ).length || 0,
              "Facts waiting for a closer look",
            ],
            [
              "Research packs",
              data?.packs.length || 0,
              "Versioned handovers for storyboarding",
            ],
          ].map(([label, note, sub]) => (
            <U.Card key={label} className="shadow-none">
              <U.CardContent className="p-5">
                <p className="text-p4 text-muted-foreground">{label}</p>
                <p className="text-h3 mt-2 mb-1">{note}</p>
                <p className="text-p5 text-muted-foreground">{sub}</p>
              </U.CardContent>
            </U.Card>
          ))}
        </div>
        <U.DataTable
          data={organisations}
          getRowId={(r) => r.id}
          defaultPageSize={8}
          itemLabel="organisations"
          showColumnVisibility={false}
          toolbar={
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <U.Input
                aria-label="Search organisations"
                placeholder="Search organisations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:max-w-sm"
              />
              <div className="sm:w-56">
                <Pick
                  value={filter}
                  onChange={setFilter}
                  label="Filter status"
                  options={[
                    ["all", "All statuses"],
                    ["researching", "Researching"],
                    ["ready", "Ready for storyboarding"],
                    ["draft", "Draft"],
                  ]}
                />
              </div>
            </div>
          }
          columns={[
            {
              id: "name",
              header: "Organisation",
              accessor: (o) => o.name,
              sortable: true,
              cell: (o) => (
                <div className="flex items-center gap-3">
                  <U.PartnerAvatar fallback={initials(o.name)} alt={o.name} />
                  <div>
                    <U.Button
                      variant="link"
                      className="p-0 h-auto font-semibold text-left"
                      onClick={() => nav(`/org/${o.id}/overview`)}
                    >
                      {o.name}
                    </U.Button>
                    <p className="text-p5 text-muted-foreground">
                      {o.division || o.country}
                    </p>
                  </div>
                </div>
              ),
            },
            {
              id: "roles",
              header: "Roles",
              accessor: (o) =>
                data!.roles.filter((r) => r.orgId === o.id).length,
            },
            {
              id: "status",
              header: "Research status",
              cell: (o) => <Status value={orgState(o)} />,
            },
            { id: "owner", header: "Research lead", accessor: (o) => o.owner },
            {
              id: "updated",
              header: "Updated",
              accessor: (o) => o.updatedAt,
              cell: (o) => (
                <span className="text-p4 text-muted-foreground">
                  {date(o.updatedAt)}
                </span>
              ),
            },
            {
              id: "open",
              header: "",
              cell: (o) => (
                <U.Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Open ${o.name}`}
                  onClick={() => nav(`/org/${o.id}/overview`)}
                >
                  <U.IconArrowRight size={20} />
                </U.Button>
              ),
            },
          ]}
          empty={
            data?.organisations.length ? (
              <Empty
                title="No organisations match"
                description={
                  search
                    ? `Nothing matches “${search}”${filter === "all" ? "" : " with that status"}.`
                    : "No organisations have that research status."
                }
                action={
                  <U.Button variant="outline" onClick={clearFilters}>
                    Clear search and filters
                  </U.Button>
                }
              />
            ) : (
              <Empty
                title="Your research starts here"
                description="Create an organisation to bring together evidence about it, role research and questions for the organisation."
                action={
                  <U.Button
                    variant="outline"
                    onClick={() => setModal({ type: "organisation" })}
                  >
                    Create your first organisation
                  </U.Button>
                }
              />
            )
          }
        />
      </>
    );
  };
  const researchButton = (
    <U.Button disabled={busy} onClick={() => setModal({ type: "research" })}>
      <U.IconMagicWand size={20} />
      Extract facts and evidence
    </U.Button>
  );
  const startResearch = async (
    tier: string,
    scopeRoleId?: string,
    sections?: Section[],
    sourceIds?: string[],
    crawl?: boolean,
  ) => {
    const job: ResearchJob = await post(`/organisations/${org!.id}/research`, {
      tier,
      roleId: scopeRoleId,
      sections,
      sourceIds,
      crawl,
    });
    await reload();
    U.toast({
      title: "Research started",
      description: "Progress is shown at the top of the page as it runs.",
    });
    return job;
  };
  const cancelRun = async (j: ResearchJob) => {
    setCancelling(undefined);
    await run(() => post(`/jobs/${j.id}/cancel`, {}), "Run cancelled");
  };
  const retryRun = (j: ResearchJob) =>
    run(
      () =>
        post(`/organisations/${org!.id}/research`, {
          ...retryResearchBody(j),
        }),
      "Research started again",
    );
  function renderOverview() {
    const o = org!;
    const orgSources = data?.sources.filter((x) => x.orgId === o.id) || [];
    const orgFindings = data?.findings.filter((x) => x.orgId === o.id) || [];
    const orgQuestions = data?.questions.filter((x) => x.orgId === o.id) || [];
    const orgJobs = data?.jobs.filter((x) => x.orgId === o.id) || [];
    const kindCounts = (
      [
        ["web", "web page"],
        ["document", "document"],
        ["statement", "statement"],
        ["image", "image"],
        ["occupation", "occupation source"],
      ] as const
    )
      .map(([kind, label]) => [
        orgSources.filter((x) => x.kind === kind).length,
        label,
      ])
      .filter(([n]) => (n as number) > 0)
      .map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`);
    const accepted = orgFindings.filter((f) => f.review === "accepted").length;
    const awaiting = orgFindings.filter((f) =>
      ["unreviewed", "clarification"].includes(f.review),
    ).length;
    const openQuestions = orgQuestions.filter(
      (q) => q.status !== "answered",
    ).length;
    const lastRun = [...orgJobs].sort((x, y) =>
      y.updatedAt.localeCompare(x.updatedAt),
    )[0];
    const runLabel: Record<string, string> = {
      queued: "queued",
      researching: "in progress",
      completed: "completed",
      gaps: "completed with gaps",
      failed: "failed",
      cancelled: "cancelled",
    };
    const host = (() => {
      try {
        return o.website
          ? new URL(o.website).hostname.replace(/^www\./, "")
          : "";
      } catch {
        return o.website;
      }
    })();
    const detail = (label: string, value: ReactNode, muted = false) => (
      <div key={label} className="min-w-0">
        <dt className="text-p5 text-muted-foreground">{label}</dt>
        <dd
          className={`text-p4 mt-0.5 break-words ${muted ? "text-muted-foreground" : ""}`}
        >
          {value}
        </dd>
      </div>
    );
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <U.Card className="lg:col-span-2">
            <U.CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
                <div className="min-w-0 flex-1">
                  <U.CardTitle>About this organisation</U.CardTitle>
                  <U.CardDescription>
                    Working context for the team. Individual claims are checked
                    in Evidence.
                  </U.CardDescription>
                </div>
                <U.Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-start"
                  onClick={() => setModal({ type: "organisation", item: o })}
                >
                  Edit organisation
                </U.Button>
              </div>
            </U.CardHeader>
            <U.CardContent className="space-y-6">
              {o.summary ? (
                <p className="text-p3 whitespace-pre-wrap">{o.summary}</p>
              ) : (
                <div className="rounded-lg border border-dashed p-4">
                  <p className="text-p4 font-medium">No overview yet</p>
                  <p className="text-p5 text-muted-foreground mt-1">
                    A short description of what the organisation does and why it
                    matters for this research helps the whole team. It is
                    context, not evidence.
                  </p>
                  <U.Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 -ml-3"
                    onClick={() => setModal({ type: "organisation", item: o })}
                  >
                    Add an overview
                    <U.IconArrowRight size={16} />
                  </U.Button>
                </div>
              )}
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
                {detail(
                  "Website",
                  o.website ? (
                    <a
                      className="inline-flex items-center gap-1 underline underline-offset-4"
                      href={o.website}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <U.IconGlobeWorld size={16} />
                      {host}
                    </a>
                  ) : (
                    "Not recorded"
                  ),
                  !o.website,
                )}
                {detail(
                  "Country",
                  <span className="inline-flex items-center gap-1">
                    <U.IconLocationPin size={16} />
                    {o.country}
                  </span>,
                )}
                {detail(
                  "Scope",
                  <span className="inline-flex items-center gap-1">
                    <U.IconWork size={16} />
                    {o.division || "Whole organisation"}
                  </span>,
                )}
                {detail("Research lead", o.owner || "Unassigned", !o.owner)}
                {detail(
                  "Sources",
                  kindCounts.length > 1
                    ? `${orgSources.length} · ${kindCounts.join(", ")}`
                    : kindCounts[0] || "None captured yet",
                  !orgSources.length,
                )}
                {detail(
                  "Facts",
                  orgFindings.length
                    ? `${accepted} accepted · ${awaiting} awaiting review`
                    : "None yet",
                  !orgFindings.length,
                )}
                {detail(
                  "Open questions",
                  openQuestions
                    ? `${openQuestions} of ${orgQuestions.length}`
                    : orgQuestions.length
                      ? "All answered"
                      : "None",
                  !openQuestions,
                )}
                {detail(
                  "Last research run",
                  lastRun
                    ? `${date(lastRun.updatedAt)} · ${runLabel[lastRun.status] || lastRun.status}`
                    : "Not run yet",
                  !lastRun,
                )}
              </dl>
              {o.brandNotes && (
                <div>
                  <p className="text-p5 text-muted-foreground">
                    Brand and permissions notes
                  </p>
                  <p className="text-p4 whitespace-pre-wrap mt-0.5">
                    {o.brandNotes}
                  </p>
                </div>
              )}
              <p className="text-p5 text-muted-foreground">
                Updated {date(o.updatedAt)}
              </p>
            </U.CardContent>
          </U.Card>
          <U.Card className="bg-brand-teal-100">
            <U.CardHeader>
              <U.CardTitle>From evidence to experience</U.CardTitle>
            </U.CardHeader>
            <U.CardContent className="space-y-4 text-p4">
              <p>1. Add sources and scope a role.</p>
              <p>2. Research and review the evidence.</p>
              <p>3. Export a stable pack for storyboarding.</p>
              <DismissibleNote
                id="ready-pack-handover"
                title="About ready packs"
              >
                A ready pack is a research handover, not the organisation's
                approval.
              </DismissibleNote>
            </U.CardContent>
          </U.Card>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
          <div>
            <h2 className="text-h5">Roles at {org!.name}</h2>
            <p className="text-p4 text-muted-foreground mt-1">
              A focused research profile for each working day.
            </p>
          </div>
          <U.Button
            variant="outline"
            onClick={() => setModal({ type: "role" })}
          >
            <U.IconAdd size={20} />
            Add role
          </U.Button>
        </div>
        {orgRoles.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {orgRoles.map((r) => (
              <U.Card key={r.id}>
                <U.CardContent className="p-5 space-y-3">
                  <U.IconWork size={24} />
                  <h3 className="text-h6">{r.title}</h3>
                  <p className="text-p4 text-muted-foreground line-clamp-2">
                    {r.responsibilities}
                  </p>
                  <U.Button
                    variant="ghost"
                    size="sm"
                    onClick={() => nav(`/org/${org!.id}/roles`, { role: r.id })}
                  >
                    View role research
                    <U.IconArrowRight size={16} />
                  </U.Button>
                </U.CardContent>
              </U.Card>
            ))}
          </div>
        ) : (
          <U.Card>
            <Empty
              title="Add your first role"
              description="Start with the job title and what the person is responsible for."
              action={
                <U.Button
                  variant="outline"
                  onClick={() => setModal({ type: "role" })}
                >
                  Add role
                </U.Button>
              }
            />
          </U.Card>
        )}
        <U.Card id="research-runs">
          <U.CardHeader>
            <U.CardTitle>Research runs</U.CardTitle>
            <U.CardDescription>
              Completed evidence is retained if a source or provider fails.
            </U.CardDescription>
          </U.CardHeader>
          <U.CardContent>
            {!runs.length ? (
              <Empty
                title="No research runs yet"
                description="Research reads the organisation website and captured sources, then drafts facts and questions for review."
                action={
                  <U.Button
                    variant="outline"
                    onClick={() => setModal({ type: "research" })}
                  >
                    <U.IconMagicWand size={20} />
                    Start research
                  </U.Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {runs.map((j, i) => {
                  const card = (
                    <RunCard
                      job={j}
                      roles={orgRoles}
                      badge={<Status value={j.status} />}
                      busy={busy}
                      onCancel={() => setCancelling(j)}
                      onRetry={() => void retryRun(j)}
                    />
                  );
                  // Live and the latest run are shown in full; older runs
                  // collapse to one line so the history stays scannable.
                  return isActive(j) || i === 0 ? (
                    <div key={j.id}>{card}</div>
                  ) : (
                    <details key={j.id} className="group">
                      <summary className="cursor-pointer flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 group-open:mb-2">
                        <span className="text-p4">
                          {scopeTitle(j, orgRoles)} · {date(j.createdAt)} ·{" "}
                          {TIER_NAME[j.tier]}
                        </span>
                        <span className="flex items-center gap-3">
                          <Status value={j.status} />
                          <span className="text-p5 text-muted-foreground">
                            <span className="group-open:hidden">Details</span>
                            <span className="hidden group-open:inline">
                              Hide
                            </span>
                          </span>
                        </span>
                      </summary>
                      {card}
                    </details>
                  );
                })}
              </div>
            )}
          </U.CardContent>
        </U.Card>
      </div>
    );
  }
  function renderEvidence() {
    const shownFindings = findings.filter(
      (f) =>
        (filter === "all" || f.review === filter) &&
        (sectionFilter === "all" || sectionOfSlot(f.slot) === sectionFilter) &&
        (tierFilter === "all" || String(f.tier) === tierFilter) &&
        (sourceFilter === "all" ||
          f.citations.some((citation) => citation.sourceId === sourceFilter)) &&
        (runFilter === "all" || f.runIds.includes(runFilter)) &&
        f.claim.toLowerCase().includes(search.toLowerCase()),
    );
    const reviewShown = async (review: "accepted" | "rejected") => {
      await post("/findings/bulk-review", {
        ids: shownFindings.map((finding) => finding.id),
        review,
      });
    };
    const orgHasFindings = data?.findings.some((f) => f.orgId === org?.id);
    const openFolder =
      evidenceMode === "folder" && sectionFilter !== "all"
        ? sectionData?.sections.find((item) => item.section === sectionFilter)
        : undefined;
    const setFolderStatus = async (
      section: Section,
      stage: "gathering" | "reviewed",
    ) => {
      const summary = sectionData?.sections.find(
        (item) => item.section === section,
      );
      await run(
        () =>
          api(`/orgs/${org!.id}/sections/${section}/status`, {
            method: "PUT",
            body: JSON.stringify({
              stage,
              roleId:
                summary?.roleScoped && roleId !== "all" ? roleId : undefined,
            }),
          }),
        stage === "reviewed" ? "Folder marked reviewed" : "Reviewed tick removed",
      );
    };
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <U.Button
              variant={
                evidenceMode === "sections" || evidenceMode === "folder"
                  ? "secondary"
                  : "ghost"
              }
              onClick={() => setEvidenceMode("sections")}
            >
              Folders
            </U.Button>
            <U.Button
              variant={evidenceMode === "findings" ? "secondary" : "ghost"}
              onClick={() => setEvidenceMode("findings")}
            >
              Facts ({findings.length})
            </U.Button>
          </div>
          <U.Button
            variant="outline"
            onClick={() =>
              setModal({
                type: evidenceMode === "findings" ? "finding" : "research",
              })
            }
          >
            {evidenceMode === "findings" ? (
              <U.IconAdd size={20} />
            ) : (
              <U.IconMagicWand size={20} />
            )}
            {evidenceMode === "findings"
              ? "Record fact"
              : "Extract facts and evidence"}
          </U.Button>
        </div>
        {evidenceMode === "folder" ? (
          sectionsLoading ? (
            <U.Skeleton className="h-64 rounded-xl" />
          ) : sectionsError ? (
            <U.Alert role="alert" variant="destructive">
              <U.AlertTitle>Folder could not be loaded</U.AlertTitle>
              <U.AlertDescription>{sectionsError}</U.AlertDescription>
            </U.Alert>
          ) : !openFolder ? (
            <U.Alert role="alert">
              <U.AlertTitle>Folder not found</U.AlertTitle>
              <U.AlertDescription>
                This folder is not available in the current role scope.
                Returning to all folders.
              </U.AlertDescription>
            </U.Alert>
          ) : (
            <FolderView
              summary={openFolder}
              sources={sources.filter(
                (item) => item.folder === openFolder.folder,
              )}
              findings={findings.filter(
                (item) => sectionOfSlot(item.slot) === openFolder.section,
              )}
              canEditNote={canEditSectionNote(
                openFolder,
                !!session &&
                  ["researcher", "reviewer", "admin"].includes(session.role),
                roleId === "all" ? undefined : roleId,
              )}
              noteEditHint={
                openFolder.roleScoped &&
                roleId === "all" &&
                !!session &&
                ["researcher", "reviewer", "admin"].includes(session.role)
                  ? "Choose a role to write a note for this folder."
                  : undefined
              }
              onBack={() => {
                const next = new URLSearchParams(query);
                next.delete("section");
                next.delete("view");
                replaceQuery(next);
              }}
              onSource={setSource}
              onFill={(slot) => setModal({ type: "finding", item: { slot } })}
              onFact={setEvidence}
              onSaveNote={async (text) => {
                if (openFolder.roleScoped && roleId === "all")
                  throw new Error(
                    "Choose a role to write a note for this folder.",
                  );
                await run(
                  () =>
                    api(
                      `/orgs/${org!.id}/sections/${openFolder.section}/note`,
                      {
                        method: "PUT",
                        body: JSON.stringify({
                          text,
                          roleId: openFolder.roleScoped ? roleId : undefined,
                        }),
                      },
                    ),
                  "Note saved",
                  {
                    rethrow: true,
                    afterReload: async () => {
                      const refreshed = await api<SectionsResponse>(
                        `/orgs/${org!.id}/sections${
                          roleId === "all"
                            ? ""
                            : `?roleId=${encodeURIComponent(roleId)}`
                        }`,
                      );
                      setSectionData(refreshed);
                    },
                  },
                );
              }}
            />
          )
        ) : evidenceMode === "sections" ? (
          sectionsError ? (
            <U.Alert role="alert" variant="destructive">
              <U.AlertTitle>Sections could not be loaded</U.AlertTitle>
              <U.AlertDescription>{sectionsError}</U.AlertDescription>
            </U.Alert>
          ) : (
            <SectionsView
              sections={sectionData?.sections || []}
              selected={
                sectionFilter === "all" ? undefined : (sectionFilter as Section)
              }
              loading={sectionsLoading}
              canReview={session?.role !== "researcher"}
              busy={busy}
              onSelect={(section) => {
                const next = new URLSearchParams(query);
                next.set("section", section);
                next.set("view", "folder");
                replaceQuery(next);
              }}
              onAdd={(section, kind) => {
                const detail = sharedSections.find(
                  (item) => item.section === section,
                )!;
                setModal({ type: kind, item: { folder: detail.folder } });
              }}
              onStatus={(section, stage) =>
                void setFolderStatus(section, stage)
              }
              onExtract={(section) => {
                const detail = sectionData?.sections.find(
                  (item) => item.section === section,
                );
                if (!detail) return;
                const readable = sources.filter(
                  (source) => !!source.text && !source.error,
                );
                setModal({
                  type: "research",
                  item: {
                    section,
                    sourceIds: extractionSourceIds(readable, detail.folder),
                  },
                });
              }}
            />
          )
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <U.Input
                aria-label="Search facts"
                placeholder="Search facts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:max-w-sm"
              />
              <div className="sm:w-60">
                <Pick
                  label="Fact filter"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    ["all", "All facts"],
                    ["accepted", "Registered"],
                    ["rejected", "Excluded"],
                  ]}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Pick
                label="Section"
                value={sectionFilter}
                onChange={setSectionFilter}
                options={[
                  ["all", "All sections"],
                  ...sharedSections.map(
                    (section) =>
                      [section.section, section.title] as [string, string],
                  ),
                ]}
              />
              <Pick
                label="Tier"
                value={tierFilter}
                onChange={(value) => setParam("tier", value, "all")}
                options={[
                  ["all", "All tiers"],
                  ...([1, 2, 3, 4] as Tier[]).map(
                    (tier) =>
                      [String(tier), `Tier ${tier} · ${tierNames[tier]}`] as [
                        string,
                        string,
                      ],
                  ),
                ]}
              />
              <Pick
                label="Source"
                value={sourceFilter}
                onChange={(value) => setParam("source", value, "all")}
                options={[
                  ["all", "All sources"],
                  ...sources.map(
                    (source) => [source.id, source.title] as [string, string],
                  ),
                ]}
              />
              <Pick
                label="Research run"
                value={runFilter}
                onChange={(value) => setParam("run", value, "all")}
                options={[
                  ["all", "All runs"],
                  ...runs.map(
                    (researchRun) =>
                      [
                        researchRun.id,
                        `${date(researchRun.createdAt)} · ${TIER_NAME[researchRun.tier]}`,
                      ] as [string, string],
                  ),
                ]}
              />
            </div>
            {!!shownFindings.length && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-p5 text-muted-foreground">
                  {shownFindings.length} fact
                  {shownFindings.length === 1 ? "" : "s"} shown
                </span>
                <U.Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => reviewShown("accepted"),
                      "Shown facts registered",
                    )
                  }
                >
                  Register all shown
                </U.Button>
                <U.Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => reviewShown("rejected"),
                      "Shown facts excluded",
                    )
                  }
                >
                  Exclude all shown
                </U.Button>
              </div>
            )}
            <div className="space-y-3">
              {shownFindings.map((f) => (
                <U.Card key={f.id}>
                  <U.CardContent className="p-5">
                    <div className="flex flex-wrap gap-2 mb-3">
                      <U.Badge variant="outline">{labels[f.kind]}</U.Badge>
                      <U.Badge variant="outline">
                        Tier {f.tier || 4} · {tierNames[f.tier || 4]}
                      </U.Badge>
                      {slotLabel(f.slot) && (
                        <U.Badge variant="outline">{slotLabel(f.slot)}</U.Badge>
                      )}
                      <Status value={f.review} />
                      {f.citations.some((c) => c.unmatched) && (
                        <U.Badge variant="warning">
                          Check the source: quote not found word for word
                        </U.Badge>
                      )}
                      {f.runIds.length > 1 && (
                        <U.Badge variant="outline">
                          Found in {f.runIds.length} runs
                        </U.Badge>
                      )}
                    </div>
                    <p className="text-p3 font-medium">{f.claim}</p>
                    {f.citations[0] && (
                      <blockquote className="border-l-2 border-brand-teal pl-4 mt-4 text-p4 text-muted-foreground line-clamp-2">
                        “{f.citations[0].quote}”
                      </blockquote>
                    )}
                    <div className="flex flex-wrap justify-between items-center gap-3 mt-4">
                      <span className="text-p5 text-muted-foreground">
                        {f.citations.length} source reference
                        {f.citations.length === 1 ? "" : "s"} ·{" "}
                        {date(f.updatedAt)}
                      </span>
                      <U.Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEvidence(f)}
                      >
                        Inspect & review
                        <U.IconArrowRight size={16} />
                      </U.Button>
                    </div>
                  </U.CardContent>
                </U.Card>
              ))}
            </div>
            {!shownFindings.length && (
              <U.Card>
                {findings.length ? (
                  <Empty
                    title="No facts match"
                    description={
                      search
                        ? `Nothing matches “${search}”${filter === "all" ? "" : " in that review state"}.`
                        : `No facts are ${labels[filter]?.toLowerCase() || "in that state"}${roleId === "all" ? "" : " for this role"}.`
                    }
                    action={
                      <U.Button variant="outline" onClick={clearFilters}>
                        Clear filters
                      </U.Button>
                    }
                  />
                ) : roleId !== "all" && orgHasFindings ? (
                  <Empty
                    title="No facts for this role"
                    description="Facts recorded for other roles or for the whole organisation are hidden by the role scope."
                    action={
                      <U.Button
                        variant="outline"
                        onClick={() => setRoleId("all")}
                      >
                        Show all roles
                      </U.Button>
                    }
                  />
                ) : (
                  <Empty
                    title="Evidence comes before the story"
                    description="Add source material, then run research or record a fact yourself. Every factual claim needs an exact supporting passage."
                    action={
                      <U.Button
                        variant="outline"
                        onClick={() => setEvidenceMode("sections")}
                      >
                        Open folders
                      </U.Button>
                    }
                  />
                )}
              </U.Card>
            )}
          </>
        )}
      </div>
    );
  }
  function renderRoles() {
    return (
      <div className="space-y-6">
        <div className="flex justify-between gap-3 items-center">
          <h2 className="text-h5">Role profiles</h2>
          <U.Button
            variant="outline"
            onClick={() => setModal({ type: "role" })}
          >
            Add role
          </U.Button>
        </div>
        {orgRoles
          .filter((r) => roleId === "all" || r.id === roleId)
          .map((r) => (
            <U.Card key={r.id}>
              <U.CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <U.CardTitle>{r.title}</U.CardTitle>
                    <U.CardDescription className="mt-2">
                      {[r.location, r.seniority].filter(Boolean).join(" · ") ||
                        "Location and seniority not specified"}
                    </U.CardDescription>
                  </div>
                   <div className="flex flex-wrap items-center gap-2">
                    <U.Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setModal({ type: "role", item: r })}
                    >
                      Edit role
                    </U.Button>
                    {session?.role !== "researcher" && (
                      <U.Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          setModal({ type: "delete-role", item: r })
                        }
                      >
                        Delete role
                      </U.Button>
                    )}
                  </div>
                </div>
              </U.CardHeader>
              <U.CardContent className="space-y-5">
                <div>
                  <p className="text-label-3 mb-2">Responsibilities</p>
                  <p className="text-p3 whitespace-pre-wrap">
                    {r.responsibilities}
                  </p>
                </div>
                <div>
                  <p className="text-label-3 mb-2">Decision boundaries</p>
                  <p className="text-p4 text-muted-foreground whitespace-pre-wrap">
                    {r.boundaries ||
                      "Needs confirmation from the organisation."}
                  </p>
                </div>
                <div className="border-t border-border pt-5">
                  <div className="flex flex-wrap gap-3 justify-between items-center mb-3">
                    <h3 className="text-h6">Occupational context</h3>
                    <div className="flex flex-wrap gap-2">
                      <U.Button size="sm" onClick={() => setMatcher(r)}>
                        Find in official datasets
                      </U.Button>
                      <U.Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setModal({ type: "occupation", item: r })
                        }
                      >
                        Record manually
                      </U.Button>
                    </div>
                  </div>
                  {r.occupations.length ? (
                    r.occupations.map((o, i) => (
                      <div
                        key={i}
                        className="bg-muted rounded-xl p-4 mt-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-p3 font-medium">{o.title}</p>
                          <U.Badge variant="outline">
                            {o.status === "confirmed"
                              ? "Reviewed match"
                              : "Proposed — needs review"}
                          </U.Badge>
                          {(o.jurisdiction === "US" ||
                            o.scheme === "O*NET") && (
                            <U.Badge variant="outline">US data</U.Badge>
                          )}
                          <U.Badge variant="outline">
                            {o.basis === "dataset-search"
                              ? "Dataset search"
                              : "Recorded manually"}
                          </U.Badge>
                        </div>
                        <p className="text-p5">
                          {o.scheme} {o.code} · {o.datasetVersion}
                        </p>
                        <p className="text-p4">{o.rationale}</p>
                        <a
                          className="text-p4 underline"
                          target="_blank"
                          rel="noreferrer"
                          href={o.sourceUrl}
                        >
                          View dataset source
                        </a>
                        {(
                          [
                            ["Skills", o.skills],
                            ["Knowledge", o.knowledge],
                            ["Work context", o.workContext],
                          ] as [string, string[] | undefined][]
                        ).map(([label, values]) =>
                          values?.length ? (
                            <p className="text-p4" key={label}>
                              <strong>{label}:</strong> {values.join("; ")}
                            </p>
                          ) : null,
                        )}
                        {o.activities.map((a, j) => (
                          <p key={j} className="text-p4">
                            • {a}
                          </p>
                        ))}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <U.Button
                            variant={
                              o.status === "confirmed" ? "ghost" : "outline"
                            }
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () =>
                                  post(`/roles/${r.id}/occupations/status`, {
                                    scheme: o.scheme,
                                    code: o.code,
                                    status:
                                      o.status === "confirmed"
                                        ? "proposed"
                                        : "confirmed",
                                    version: r.version,
                                  }),
                                o.status === "confirmed"
                                  ? "Match returned to proposed"
                                  : "Match confirmed",
                              )
                            }
                          >
                            {o.status === "confirmed"
                              ? "Return to proposed"
                              : "Confirm match"}
                          </U.Button>
                          <span className="text-p5 text-muted-foreground">
                            {o.jurisdiction === "US"
                              ? "Confirm only after checking UK relevance."
                              : "Confirm once you have checked it against the role."}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-p4 text-muted-foreground">
                      No reviewed matches yet. Use an official UK SOC or O*NET
                      record, then record the match and its source.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 mt-3 text-p5">
                    <a
                      href="https://www.ons.gov.uk/methodology/classificationsandstandards/standardoccupationalclassificationsoc/soc2020"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      UK SOC reference
                    </a>
                    <a
                      href={`https://www.onetonline.org/find/quick?s=${encodeURIComponent(r.title)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Find O*NET occupations
                    </a>
                  </div>
                </div>
              </U.CardContent>
            </U.Card>
          ))}
        {!orgRoles.length && (
          <Empty
            title="Scope the work first"
            description="Add a role to connect responsibilities, occupational context and evidence."
          />
        )}
      </div>
    );
  }
  function renderQuestions() {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="text-h5">Questions for a better brief</h2>
            <DismissibleNote
              id="questions-guidance"
              title="Working with unknowns"
              className="mt-2"
            >
              Keep unknowns explicit. Defer what the organisation needs to
              confirm.
            </DismissibleNote>
          </div>
          <U.Button
            variant="outline"
            onClick={() => setModal({ type: "question" })}
          >
            Add question
          </U.Button>
        </div>
        {questions.map((q) => (
          <U.Card key={q.id}>
            <U.CardContent className="p-5 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Status value={q.status} />
                {q.blocking && (
                  <U.Badge variant="outline">
                    Listed as an open item
                  </U.Badge>
                )}
              </div>
              <h3 className="text-h6">{q.text}</h3>
              <p className="text-p4 text-muted-foreground">{q.why}</p>
              {q.answer && (
                <div className="p-4 rounded-xl bg-muted">
                  <p className="text-p3 whitespace-pre-wrap">{q.answer}</p>
                  <p className="text-p5 text-muted-foreground mt-2">
                    Source: {q.provenance}
                  </p>
                </div>
              )}
              <div className="flex flex-wrap justify-between gap-3 items-center">
                <p className="text-p5 text-muted-foreground">
                  {q.assignee ? `Assigned to ${q.assignee}` : "Unassigned"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {q.status === "answered" && q.answer.trim() && (
                    <U.Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setModal({ type: "question-fact", item: q })
                      }
                    >
                      Turn the answer into a fact
                    </U.Button>
                  )}
                  <U.Button
                    variant="outline"
                    size="sm"
                    onClick={() => setModal({ type: "question", item: q })}
                  >
                    Respond or defer
                  </U.Button>
                </div>
              </div>
            </U.CardContent>
          </U.Card>
        ))}
        {!questions.length && (
          <U.Card>
            {roleId !== "all" &&
            data?.questions.some((q) => q.orgId === org?.id) ? (
              <Empty
                title="No questions for this role"
                description="Questions for other roles or for the whole organisation are hidden by the role scope."
                action={
                  <U.Button variant="outline" onClick={() => setRoleId("all")}>
                    Show all roles
                  </U.Button>
                }
              />
            ) : (
              <Empty
                title="No questions recorded"
                description="When something is uncertain, capture the question and explain which design decision it affects."
              />
            )}
          </U.Card>
        )}
      </div>
    );
  }
  function renderPacks() {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="text-h5">Research packs</h2>
            <p className="text-p4 text-muted-foreground mt-2">
              Frozen reference inputs for storyboard drafting.
            </p>
          </div>
          <U.Button
            variant="outline"
            disabled={!orgRoles.length}
            onClick={() => setModal({ type: "pack" })}
          >
            Create research pack
          </U.Button>
        </div>
        <DismissibleNote id="research-pack-intro" title="About research packs">
          A research pack is a fixed copy of the role's evidence at the moment
          it is created. Later edits never change it; create a new pack instead.
        </DismissibleNote>
        {packs.map((p) => (
          <U.Card key={p.id}>
            <U.CardContent className="p-5">
              <div className="flex flex-col sm:flex-row justify-between gap-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <U.Badge variant="outline">Revision {p.revision}</U.Badge>
                    <Status value={p.status} />
                  </div>
                  <h3 className="text-h6">{p.role.title}</h3>
                  <p className="text-p5 text-muted-foreground">
                    {date(p.createdAt)} · {p.findings.length} facts ·{" "}
                    {p.sources.length} sources · Schema {p.schemaVersion}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <U.Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(
                        () =>
                          download(
                            `/packs/${p.id}/md`,
                            `${org!.name}-research-r${p.revision}.md`,
                          ),
                        "Markdown downloaded",
                      )
                    }
                  >
                    <U.IconDownload size={16} />
                    Markdown
                  </U.Button>
                  <U.Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(
                        () =>
                          download(
                            `/packs/${p.id}/json`,
                            `${org!.name}-research-r${p.revision}.json`,
                          ),
                        "JSON downloaded",
                      )
                    }
                  >
                    JSON
                  </U.Button>
                  <U.Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(
                        () =>
                          download(
                            `/packs/${p.id}/docx`,
                            `${org!.name}-research-r${p.revision}.docx`,
                          ),
                        "DOCX downloaded",
                      )
                    }
                  >
                    <U.IconDownload size={16} />
                    Download DOCX
                  </U.Button>
                  <U.Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(
                        () =>
                          download(
                            `/packs/${p.id}/zip`,
                            `${org!.name}-research-r${p.revision}.zip`,
                          ),
                        "Folder downloaded",
                      )
                    }
                  >
                    <U.IconDownload size={16} />
                    Download folder (ZIP)
                  </U.Button>
                  {p.schemaVersion === "2.0.0" && (
                    <U.Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void run(
                          () =>
                            download(
                              `/packs/${p.id}/confirm.md`,
                              `${org!.name}-research-r${p.revision}-to-confirm.md`,
                            ),
                          "Confirmation list downloaded",
                        )
                      }
                    >
                      <U.IconDownload size={16} />
                      For the organisation to confirm
                    </U.Button>
                  )}
                </div>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-p4">
                  Open research pack
                </summary>
                <div className="mt-4 space-y-3 text-p4">
                  <p>{p.role.responsibilities}</p>
                  {p.findings.map((f) => (
                    <div key={f.id}>
                      <p className="font-medium">
                        {labels[f.kind]} · {labels[f.review]}
                      </p>
                      <p>{f.claim}</p>
                    </div>
                  ))}
                  <h4 className="font-semibold">Limitations</h4>
                  {p.limitations.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </div>
              </details>
            </U.CardContent>
          </U.Card>
        ))}
        {!packs.length && (
          <U.Card>
            {roleId !== "all" &&
            data?.packs.some((p) => p.organisation.id === org?.id) ? (
              <Empty
                title="No packs for this role"
                description="Packs created for other roles are hidden by the role scope."
                action={
                  <U.Button variant="outline" onClick={() => setRoleId("all")}>
                    Show all roles
                  </U.Button>
                }
              />
            ) : (
              <Empty
                title="Your research, ready to hand over"
                description="Create a draft pack at any point. A reviewer can mark a pack ready after the evidence review is complete."
              />
            )}
          </U.Card>
        )}
      </div>
    );
  }
  const renderSettings = () => (
    <>
      {pageHeading(
        "Workspace",
        "Team & settings",
        "Team access, research connections and research instructions. Access is managed independently from the wider platform.",
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <U.Card>
          <U.CardHeader>
            <U.CardTitle>Team access</U.CardTitle>
            <U.CardDescription>
              Clerk identity with separate application permissions.
            </U.CardDescription>
          </U.CardHeader>
          <U.CardContent className="space-y-4">
            {data?.members.map((m) => (
              <div
                key={m.userId}
                className="flex gap-3 justify-between items-center"
              >
                <div>
                  <p className="text-p3">{m.name}</p>
                  {m.role && (
                    <p className="text-p5 text-muted-foreground">
                      {m.role} · {m.active ? "Active" : "Revoked"}
                    </p>
                  )}
                </div>
                {session?.role === "admin" && (
                  <U.Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModal({ type: "member", item: m })}
                  >
                    Edit
                  </U.Button>
                )}
              </div>
            ))}
            {session?.role === "admin" &&
              (data?.invitations ?? []).map((i) => (
                <div
                  key={i.id}
                  className="flex gap-3 justify-between items-center"
                >
                  <div>
                    <p className="text-p3">{i.name}</p>
                    <p className="text-p5 text-muted-foreground">
                      {i.role} · Invited ({i.email}); access starts at first
                      sign-in
                    </p>
                  </div>
                  <U.Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => del(`/invitations/${i.id}`, {}),
                        "Invitation withdrawn",
                      )
                    }
                  >
                    Withdraw
                  </U.Button>
                </div>
              ))}
            {session?.role === "admin" && (
              <U.Button
                variant="outline"
                onClick={() => setModal({ type: "member" })}
              >
                Add team member
              </U.Button>
            )}
          </U.CardContent>
        </U.Card>
        <ResearchSettings
          key={session?.userId}
          session={session || null}
          members={data?.members || []}
        />
      </div>
    </>
  );
  return (
    <U.AppShell>
      <U.AppShellHeader>
        <U.MobileNavbar
          className="md:hidden"
          logo={
            <a
              href="#/"
              aria-label="Organisation Research home"
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <U.SpringpodLogo size={28} />
            </a>
          }
        >
          <U.Button
            variant="ghost"
            size="icon"
            aria-label="Team and settings"
            onClick={() => nav("/settings")}
          >
            <U.IconSettings size={20} />
          </U.Button>
          {accountControl}
        </U.MobileNavbar>
        <U.MasterNav className="hidden md:flex">
          <div className="flex items-center gap-5">
            <a
              href="#/"
              aria-label="Organisation Research home"
              className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <U.SpringpodLogo size={32} />
            </a>
            <div className="hidden sm:block border-l border-border pl-5">
              <p className="text-p3 font-semibold">Organisation Research</p>
              <p className="text-p5 text-muted-foreground">
                Learning experience studio
              </p>
            </div>
          </div>
          <U.MasterNavActions>
            {preview ? (
              <U.Badge variant="outline">Local sample workspace</U.Badge>
            ) : (
              accountControl
            )}
            <U.Button
              variant="ghost"
              size="icon"
              aria-label="Team and settings"
              onClick={() => nav("/settings")}
            >
              <U.IconSettings size={20} />
            </U.Button>
          </U.MasterNavActions>
        </U.MasterNav>
      </U.AppShellHeader>
      <U.AppShellBody>
        <U.AppShellSidebar>
          <U.SidebarNav>
            <U.SidebarNavSection title="Workspace">
              <U.SidebarNavItem
                icon={<U.IconCompany size={20} />}
                label="Organisations"
                active={path !== "/settings"}
                onClick={() => nav("/")}
              />
              <U.SidebarNavItem
                icon={<U.IconSettings size={20} />}
                label="Team & settings"
                active={path === "/settings"}
                onClick={() => nav("/settings")}
              />
            </U.SidebarNavSection>
            <U.SidebarNavFooter>
              <div className="p-4 text-p5 text-muted-foreground">
                Evidence first.
                <br />
                Better experiences follow.
              </div>
            </U.SidebarNavFooter>
          </U.SidebarNav>
        </U.AppShellSidebar>
        <U.AppShellMain id="main-content">
          <U.AppShellContent>
            <ResearchWorkspacePage>
              {preview && (
                <U.Alert className="mb-6">
                  <U.AlertDescription>
                    Local demonstration with fictional data. Changes are
                    temporary. This is not a signed-in production workspace;
                    Clerk SSO remains a deployment setup step.
                  </U.AlertDescription>
                </U.Alert>
              )}
              {error && data && (
                <U.Alert role="alert" className="mb-6">
                  <U.AlertTitle>Showing the last loaded workspace</U.AlertTitle>
                  <U.AlertDescription>
                    The latest refresh failed: {error} Retrying automatically.
                  </U.AlertDescription>
                </U.Alert>
              )}
              {error && !data ? (
                <U.Alert role="alert">
                  <U.AlertTitle>Workspace unavailable</U.AlertTitle>
                  <U.AlertDescription>{error}</U.AlertDescription>
                  <U.Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => void reload().catch(failed)}
                  >
                    Retry
                  </U.Button>
                </U.Alert>
              ) : !data ? (
                <div className="space-y-5">
                  <U.Skeleton className="h-16 w-1/2" />
                  <U.Skeleton className="h-72 w-full" />
                </div>
              ) : path === "/settings" ? (
                renderSettings()
              ) : parts[0] === "org" && !org ? (
                <Empty
                  title="Organisation not found"
                  description="It may have been removed or the link is incorrect."
                  action={
                    <U.Button onClick={() => nav("/")}>
                      Back to organisations
                    </U.Button>
                  }
                />
              ) : org ? (
                <>
                  <U.Breadcrumb className="mb-5">
                    <U.BreadcrumbList>
                      <U.BreadcrumbItem>
                        <U.BreadcrumbLink href="#/">
                          Organisations
                        </U.BreadcrumbLink>
                      </U.BreadcrumbItem>
                      <U.BreadcrumbItem>
                        {tab === "overview" ? (
                          <U.BreadcrumbPage>{org.name}</U.BreadcrumbPage>
                        ) : (
                          <U.BreadcrumbLink href={orgHref("overview")}>
                            {org.name}
                          </U.BreadcrumbLink>
                        )}
                      </U.BreadcrumbItem>
                      {tab !== "overview" && (
                        <U.BreadcrumbItem>
                          <U.BreadcrumbPage>{tabName}</U.BreadcrumbPage>
                        </U.BreadcrumbItem>
                      )}
                    </U.BreadcrumbList>
                  </U.Breadcrumb>
                  <div
                    ref={header.ref}
                    className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-5 mb-5 lg:mb-6"
                  >
                    <div className="flex items-center gap-3 lg:gap-4 min-w-0">
                      <U.PartnerAvatar
                        fallback={initials(org.name)}
                        alt={org.name}
                        size="lg"
                        className="hidden sm:inline-flex"
                      />
                      <U.PartnerAvatar
                        fallback={initials(org.name)}
                        alt={org.name}
                        size="default"
                        className="sm:hidden"
                      />
                      <div className="min-w-0">
                        <p className="hidden sm:block text-label-3 uppercase text-muted-foreground">
                          Organisation workspace
                        </p>
                        <h1 className="text-h3-mobile lg:text-h3 sm:mt-1 break-words">
                          {org.name}
                        </h1>
                        <p className="text-p5 sm:text-p4 text-muted-foreground mt-0.5 sm:mt-1">
                          {org.country} · {org.owner}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {activeJobs.length > 0 && (
                        <U.Badge
                          variant="outline"
                          className="inline-flex items-center gap-2 self-start sm:self-auto"
                        >
                          <U.Spinner className="size-3" />
                          {activeJobs.length === 1
                            ? "Researching"
                            : `${activeJobs.length} runs in progress`}
                        </U.Badge>
                      )}
                      {researchButton}
                    </div>
                  </div>
                  <ActiveRunBanner
                    jobs={activeJobs}
                    roles={orgRoles}
                    busy={busy}
                    onView={() => {
                      nav(`/org/${org.id}/overview`);
                      setTimeout(
                        () =>
                          document
                            .getElementById("research-runs")
                            ?.scrollIntoView({ behavior: "smooth" }),
                        50,
                      );
                    }}
                    onCancel={setCancelling}
                  />
                  <U.PartnerTabs
                    value={tab}
                    onValueChange={(v) =>
                      nav(`/org/${org.id}/${v}`, {
                        role: roleId === "all" ? undefined : roleId,
                      })
                    }
                  >
                    {/* On a phone the tab strip stays put while the page
                        scrolls, and once the heading has gone by it carries
                        the organisation's name and the research action. */}
                    <div className="sticky -top-6 z-10 -mx-6 px-6 -mt-2 pt-2 bg-background md:static md:mx-0 md:px-0 md:mt-0 md:pt-0 mb-6">
                      {header.past && (
                        <div className="md:hidden flex items-center justify-between gap-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <U.PartnerAvatar
                              fallback={initials(org.name)}
                              alt={org.name}
                              size="sm"
                            />
                            <p className="text-p3 font-semibold truncate">
                              {org.name}
                            </p>
                          </div>
                          <U.Button
                            size="sm"
                            disabled={busy}
                            onClick={() => setModal({ type: "research" })}
                          >
                            <U.IconMagicWand size={16} />
                            Research
                          </U.Button>
                        </div>
                      )}
                      <TabStrip>
                        <U.PartnerTabsList className="w-max min-w-full justify-start">
                          {TABS.map(([id, name]) => (
                            <U.PartnerTabsTrigger key={id} value={id}>
                              {name}
                            </U.PartnerTabsTrigger>
                          ))}
                        </U.PartnerTabsList>
                      </TabStrip>
                    </div>
                    {tab !== "overview" && (
                      <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
                        <div className="w-full sm:w-64">
                          <Pick
                            label="Role scope"
                            value={roleId}
                            onChange={setRoleId}
                            options={roleOptions}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 text-p5 text-muted-foreground">
                          <a
                            className="underline underline-offset-4 hover:text-foreground"
                            href={orgHref("evidence", { status: "accepted" })}
                          >
                            {
                              findings.filter((f) => f.review === "accepted")
                                .length
                            }{" "}
                            registered facts
                          </a>
                          <span aria-hidden="true">·</span>
                          <a
                            className="underline underline-offset-4 hover:text-foreground"
                            href={orgHref("questions")}
                          >
                            {
                              questions.filter((q) => q.status !== "answered")
                                .length
                            }{" "}
                            open questions
                          </a>
                        </div>
                      </div>
                    )}
                    <U.PartnerTabsContent value="overview">
                      {renderOverview()}
                    </U.PartnerTabsContent>
                    <U.PartnerTabsContent value="evidence">
                      {renderEvidence()}
                    </U.PartnerTabsContent>
                    <U.PartnerTabsContent value="roles">
                      {renderRoles()}
                    </U.PartnerTabsContent>
                    <U.PartnerTabsContent value="questions">
                      {renderQuestions()}
                    </U.PartnerTabsContent>
                    <U.PartnerTabsContent value="packs">
                      {renderPacks()}
                    </U.PartnerTabsContent>
                  </U.PartnerTabs>
                </>
              ) : (
                renderDirectory()
              )}
            </ResearchWorkspacePage>
          </U.AppShellContent>
        </U.AppShellMain>
      </U.AppShellBody>
      {renderModal()}
      {cancelling && (
        <U.AlertDialog
          open
          onOpenChange={(v) => {
            if (!v) setCancelling(undefined);
          }}
        >
          <U.AlertDialogContent>
            <U.AlertDialogHeader>
              <U.AlertDialogTitle>Cancel this research run?</U.AlertDialogTitle>
              <U.AlertDialogDescription>
                {scopeTitle(cancelling, orgRoles)} ·{" "}
                {TIER_NAME[cancelling.tier]}. Evidence already extracted is
                kept, but the run cannot be resumed; you can start a new one
                later.
              </U.AlertDialogDescription>
            </U.AlertDialogHeader>
            <U.AlertDialogFooter>
              <U.AlertDialogCancel>Keep running</U.AlertDialogCancel>
              <U.AlertDialogAction onClick={() => void cancelRun(cancelling)}>
                Cancel run
              </U.AlertDialogAction>
            </U.AlertDialogFooter>
          </U.AlertDialogContent>
        </U.AlertDialog>
      )}
      {evidence && data && (
        <EvidencePanel
          // Display follows the live record (a refresh may flag it while
          // open); the save still carries the version seen when opened, so a
          // change made meanwhile is rejected with 409 rather than overwritten.
          finding={data.findings.find((f) => f.id === evidence.id) || evidence}
          sources={data.sources}
          canVerify={session?.role === "reviewer" || session?.role === "admin"}
          onClose={() => setEvidence(undefined)}
          onSave={async (v) => {
            await patch(`/findings/${evidence.id}`, {
              ...v,
              version: evidence.version,
            });
            await reload();
            setEvidence(undefined);
            U.toast({ title: "Review saved" });
          }}
        />
      )}
      {matcher && (
        <OccupationMatcher
          role={data?.roles.find((r) => r.id === matcher.id) || matcher}
          onClose={() => setMatcher(undefined)}
          onManual={() => {
            setMatcher(undefined);
            setModal({ type: "occupation", item: matcher });
          }}
          onRecord={async (record: OccupationRecord) => {
            const current =
              data?.roles.find((r) => r.id === matcher.id) || matcher;
            await post(`/roles/${matcher.id}/occupations`, {
              ...record,
              version: current.version,
            });
            await reload();
            U.toast({ title: "Occupational match recorded as proposed" });
          }}
        />
      )}
      {source && (
        <SourcePanel
          source={data?.sources.find((s) => s.id === source.id) || source}
          onClose={() => setSource(undefined)}
          onSave={async (v) => {
            await patch(`/sources/${source.id}`, {
              ...v,
              version: source.version,
              roleIds: source.roleIds,
            });
            await reload();
            setSource(undefined);
            U.toast({ title: "Source updated" });
          }}
        />
      )}
      <U.Toaster />
    </U.AppShell>
  );
}
function EvidencePanel({
  finding: f,
  sources,
  canVerify,
  onClose,
  onSave,
}: {
  finding: Finding;
  sources: Source[];
  canVerify: boolean;
  onClose: () => void;
  onSave: (v: any) => Promise<void>;
}) {
  const [claim, setClaim] = useState(f.claim);
  const [kind, setKind] = useState(f.kind);
  const [status, setStatus] = useState<"accepted" | "rejected">(
    f.review === "rejected" ? "rejected" : "accepted",
  );
  const [rationale, setRationale] = useState(f.rationale);
  const [slot, setSlot] = useState<Slot>(f.slot || "none");
  const [fields, setFields] = useState<FactFieldValues>(() =>
    Object.fromEntries(
      Object.entries(f.fields || {}).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(String) : String(value ?? ""),
      ]),
    ),
  );
  const [parts, setParts] = useState<Part[]>(f.parts || []);
  const [slotTouched, setSlotTouched] = useState(false);
  const [partsTouched, setPartsTouched] = useState(false);
  const [verified, setVerified] = useState(!!f.verified);
  const [verificationNote, setVerificationNote] = useState(
    f.verified?.note || "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const slotChanged = slotTouched && slot !== (f.slot || "none");
  const partsChanged =
    partsTouched && JSON.stringify(parts) !== JSON.stringify(f.parts || []);
  const fieldsChanged =
    JSON.stringify(normaliseFactFields(fields)) !==
    JSON.stringify(f.fields || {});
  const tableSlot = !!slots.find((item) => item.slot === slot)?.table;
  const dirty =
    (!tableSlot && claim !== f.claim) ||
    kind !== f.kind ||
    status !== f.review ||
    rationale !== f.rationale ||
    slotChanged ||
    partsChanged ||
    (tableSlot && fieldsChanged) ||
    verified !== !!f.verified ||
    (verified && verificationNote !== (f.verified?.note || ""));
  const closeGuard = useFormCloseGuard({ dirty, busy, onClose });
  return (
    <U.Sheet
      open
      onOpenChange={(v) => {
        closeGuard.onOpenChange(v);
      }}
    >
      <U.SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <U.SheetHeader>
          <U.SheetTitle>Inspect the fact</U.SheetTitle>
          <U.SheetDescription>
            Registration means suitable for drafting. Readiness is not the
            organisation&apos;s approval.
          </U.SheetDescription>
        </U.SheetHeader>
        <div className="space-y-6 py-6">
          {tableSlot ? (
            <FactFields
              slot={slot}
              values={fields}
              sources={sources.filter((source) => source.orgId === f.orgId)}
              onChange={(value) => {
                setFields(value);
                setError("");
              }}
            />
          ) : (
            <div className="space-y-2">
              <U.Label htmlFor="review-claim">Fact</U.Label>
              <AutoTextarea
                id="review-claim"
                rows={4}
                value={claim}
                autoFocus
                onChange={(e) => {
                  setClaim(e.target.value);
                  setError("");
                }}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <U.Badge variant="outline">
              Tier {f.tier || 4} · {tierNames[f.tier || 4]}
            </U.Badge>
            <span className="text-p5 text-muted-foreground self-center">
              {f.verified
                ? "Derived from: verified"
                : f.citations.length
                  ? "Derived from: lowest tier of the cited sources"
                  : "Derived from: no supporting citation, so it is illustrative and declared"}
            </span>
          </div>
          <FactPlacement
            slot={slot}
            parts={parts}
            onSlotChange={(value) => {
              setSlotTouched(true);
              setSlot(value);
            }}
            onPartsChange={(value) => {
              setPartsTouched(true);
              setParts(value);
            }}
          />
          <Pick
            label="Classification"
            value={kind}
            onChange={(v) => {
              setKind(v as any);
              setError("");
            }}
            options={[
              ["company", "Organisation fact"],
              ["occupation", "Occupational context"],
              ["proposal", "Design proposal"],
            ]}
          />
          <section className="space-y-4">
            <h3 className="text-h6">Supporting passages</h3>
            {f.citations.length ? (
              f.citations.map((c, i) => {
                const s = sources.find((x) => x.id === c.sourceId);
                return (
                  <div
                    key={i}
                    className="rounded-xl border border-border p-4 space-y-3"
                  >
                    <p className="text-p3 font-medium">
                      {s?.title || "Source unavailable"}
                    </p>
                    <p className="text-p5 text-muted-foreground">
                      {c.locator} · {s ? date(s.retrievedAt) : ""}
                    </p>
                    <blockquote className="border-l-2 border-brand-teal pl-4 text-p3 whitespace-pre-wrap">
                      “{c.quote}”
                    </blockquote>
                    {c.unmatched && (
                      <U.Badge variant="warning">
                        Not found word for word in this source. Check the source says this.
                      </U.Badge>
                    )}
                    {s?.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-p4 underline"
                      >
                        Open original source
                      </a>
                    )}
                    {s && (
                      <details>
                        <summary className="text-p4 cursor-pointer">
                          Read captured context
                        </summary>
                        <p className="mt-3 text-p4 whitespace-pre-wrap break-words">
                          {s.text}
                        </p>
                      </details>
                    )}
                    <p className="text-p5 text-muted-foreground">
                      Source basis:{" "}
                      {s?.verification === "client-confirmed"
                        ? "Confirmed by the organisation"
                        : s?.verification === "public-source"
                          ? "Public source"
                          : "Team-supplied material"}
                    </p>
                  </div>
                );
              })
            ) : (
              <U.Alert>
                <U.AlertDescription>
                  No supporting passage. This item can only be treated as a
                  design proposal.
                </U.AlertDescription>
              </U.Alert>
            )}
          </section>
          <div className="space-y-2">
            <U.Label htmlFor="review-rationale">
              Review notes and uncertainty
            </U.Label>
            <AutoTextarea
              id="review-rationale"
              value={rationale}
              onChange={(e) => {
                setRationale(e.target.value);
                setError("");
              }}
            />
          </div>
          <Pick
            label="Review decision"
            value={status}
            onChange={(v) => {
              setStatus(v as any);
              setError("");
            }}
            options={[
              ["accepted", f.review === "rejected" ? "Restore" : "Registered"],
              ["rejected", "Exclude from the pack"],
            ]}
          />
          {canVerify && (
            <section className="rounded-xl border border-border p-4 space-y-3">
              <div>
                <h3 className="text-h6">Verified by the organisation</h3>
                <p className="text-p5 text-muted-foreground">
                  Use this only when the organisation has confirmed this fact.
                  Verification makes it tier 1.
                </p>
              </div>
              <div className="space-y-2">
                <U.Label htmlFor="verification-note">
                  Verification note (optional)
                </U.Label>
                <AutoTextarea
                  id="verification-note"
                  value={verificationNote}
                  onChange={(event) => setVerificationNote(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <U.Button
                  type="button"
                  variant={verified ? "secondary" : "outline"}
                  onClick={() => setVerified(true)}
                >
                  Verified by the organisation
                </U.Button>
                {(verified || f.verified) && (
                  <U.Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setVerified(false);
                      setVerificationNote("");
                    }}
                  >
                    Clear verification
                  </U.Button>
                )}
              </div>
              {f.verified && (
                <p className="text-p5 text-muted-foreground">
                  Verified by {f.verified.by} on {date(f.verified.at)}
                </p>
              )}
            </section>
          )}
          {error && (
            <U.Alert role="alert" variant="destructive">
              <U.AlertDescription>{error}</U.AlertDescription>
            </U.Alert>
          )}
          <U.Button
            disabled={
              busy ||
              (!tableSlot && !claim.trim()) ||
              (tableSlot && !factFieldsClaim(slot, fields))
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSave({
                  ...(!tableSlot ? { claim } : {}),
                  kind,
                  review: status,
                  rationale,
                  ...(slotChanged ? { slot } : {}),
                  ...(partsChanged ? { parts } : {}),
                  ...(tableSlot && fieldsChanged
                    ? { fields: normaliseFactFields(fields) }
                    : {}),
                  ...(canVerify &&
                  (verified !== !!f.verified ||
                    (verified && verificationNote !== (f.verified?.note || "")))
                    ? {
                        verified: verified
                          ? { note: verificationNote.trim() || undefined }
                          : null,
                      }
                    : {}),
                });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save review"}
          </U.Button>
          {f.history.length > 0 && (
            <details>
              <summary className="text-p4 cursor-pointer">
                Review history ({f.history.length})
              </summary>
              {f.history.map((h, i) => (
                <div
                  className="mt-3 border-t border-border pt-3 text-p5"
                  key={i}
                >
                  <p>
                    {date(h.at)} · {h.actor} · {labels[h.review]}
                  </p>
                  <p>{h.claim}</p>
                  <p>{h.rationale}</p>
                </div>
              ))}
            </details>
          )}
        </div>
      </U.SheetContent>
      {closeGuard.confirmation}
    </U.Sheet>
  );
}
function SourcePanel({
  source: s,
  onClose,
  onSave,
}: {
  source: Source;
  onClose: () => void;
  onSave: (v: any) => Promise<void>;
}) {
  const [permission, setPermission] = useState(s.permission);
  const [caption, setCaption] = useState(s.caption || "");
  const [folder, setFolder] = useState<string>(s.folder || "auto");
  const [rights, setRights] = useState<string>(s.rights || "none");
  const [folderTouched, setFolderTouched] = useState(false);
  const [rightsTouched, setRightsTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState("");
  const folderChanged = folderTouched && folder !== (s.folder || "auto");
  const rightsChanged = rightsTouched && rights !== (s.rights || "none");
  const dirty =
    permission !== s.permission ||
    caption !== (s.caption || "") ||
    folderChanged ||
    rightsChanged;
  const closeGuard = useFormCloseGuard({ dirty, busy, onClose });
  useEffect(() => {
    if (s.kind !== "image") return;
    let url = "";
    let live = true;
    fetchBlob(`/sources/${s.id}/file`, "Cannot load image")
      .then((b) => {
        if (live) {
          url = URL.createObjectURL(b);
          setImage(url);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [s.id]);
  return (
    <U.Sheet
      open
      onOpenChange={(v) => {
        closeGuard.onOpenChange(v);
      }}
    >
      <U.SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <U.SheetHeader>
          <U.SheetTitle>{s.title}</U.SheetTitle>
          <U.SheetDescription>
            Captured {date(s.retrievedAt)} · {s.suppliedBy}
          </U.SheetDescription>
        </U.SheetHeader>
        <div className="py-6 space-y-5">
          {image && (
            <img
              src={image}
              alt={s.caption || s.title}
              className="rounded-xl w-full"
            />
          )}
          {s.url && (
            <a
              className="text-p4 underline break-all"
              target="_blank"
              rel="noreferrer"
              href={s.url}
            >
              {s.url}
            </a>
          )}
          {s.filename && (
            <U.Button
              variant="outline"
              size="sm"
              onClick={() =>
                void download(`/sources/${s.id}/file`, s.filename!).catch((e) =>
                  setError(e.message),
                )
              }
            >
              Download original
            </U.Button>
          )}
          <div className="grid grid-cols-1 gap-3 rounded-xl bg-muted p-4 sm:grid-cols-2">
            <div>
              <p className="text-label-3">Section</p>
              <p className="text-p4">{folderTitle(s.folder)}</p>
            </div>
            <div>
              <p className="text-label-3">Export file name</p>
              <p className="text-p4 break-all">
                {s.exportName || "Not available"}
              </p>
            </div>
            {s.kind === "note" && (
              <div className="sm:col-span-2">
                <p className="text-label-3">Extracted from</p>
                <p className="text-p4 break-words">{s.extractedFrom}</p>
              </div>
            )}
            {s.providedBy && (
              <div className="sm:col-span-2">
                <p className="text-label-3">Provided by</p>
                <p className="text-p4">
                  {s.providedBy.name}
                  {s.providedBy.jobTitle ? ` · ${s.providedBy.jobTitle}` : ""}
                </p>
              </div>
            )}
          </div>
          {s.kind === "web" && s.url && (
            <p className="text-p5 text-muted-foreground">
              Captured {new Date(s.retrievedAt).toLocaleString()}
            </p>
          )}
          {s.error && (
            <U.Alert>
              <U.AlertDescription>{s.error}</U.AlertDescription>
            </U.Alert>
          )}
          <div>
            <p className="text-label-3 mb-2">{s.locator || "Source passage"}</p>
            <div className="max-h-80 overflow-auto bg-muted rounded-xl p-4 text-p4 whitespace-pre-wrap break-words">
              {s.text ||
                "No text extracted. Use the image and its contextual notes as a reference."}
            </div>
          </div>
          <div className="space-y-2">
            <U.Label htmlFor="source-caption">Context and usage notes</U.Label>
            <AutoTextarea
              id="source-caption"
              value={caption}
              autoFocus
              onChange={(e) => {
                setCaption(e.target.value);
                setError("");
              }}
            />
          </div>
          <Pick
            label="Section"
            value={folder}
            onChange={(value) => {
              setFolderTouched(true);
              setFolder(value);
              setError("");
            }}
            options={FOLDER_OPTIONS}
          />
          {(s.kind === "image" ||
            s.kind === "film" ||
            s.kind === "screenshot") && (
            <Pick
              label="Media rights"
              value={rights}
              onChange={(value) => {
                setRightsTouched(true);
                setRights(value);
                setError("");
              }}
              options={[
                ["none", "Not recorded"],
                ["organisation-supplied", "Supplied by the organisation"],
                ["press-kit", "Press kit"],
                ["reference-only", "Reference only"],
              ]}
            />
          )}
          <Pick
            label="Usage permission"
            value={permission}
            onChange={(v) => {
              setPermission(v as any);
              setError("");
            }}
            options={[
              ["research-only", "Research only"],
              ["awaiting-confirmation", "Awaiting permission confirmation"],
              ["learner-approved", "Approved for learner-facing use"],
            ]}
          />
          <p className="text-p5 text-muted-foreground">
            Only record learner-use approval when it has been supplied. Public
            availability does not establish permission.
          </p>
          {error && (
            <U.Alert role="alert" variant="destructive">
              <U.AlertDescription>{error}</U.AlertDescription>
            </U.Alert>
          )}
          <U.Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSave({
                  permission,
                  caption,
                  ...(folderChanged
                    ? { folder: folder === "auto" ? null : folder }
                    : {}),
                  ...(rightsChanged
                    ? {
                        rights: rights === "none" ? null : (rights as Rights),
                      }
                    : {}),
                });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save source details
          </U.Button>
        </div>
      </U.SheetContent>
      {closeGuard.confirmation}
    </U.Sheet>
  );
}
function PackModal({
  org,
  roleOptions,
  initialRole,
  onClose,
  onSaved,
}: {
  org: Organisation;
  roleOptions: [string, string][];
  initialRole: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState(initialRole);
  const [issues, setIssues] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = role !== initialRole;
  const closeGuard = useFormCloseGuard({ dirty, busy, onClose });
  useEffect(() => {
    let active = true;
    setChecking(true);
    api(`/roles/${role}/readiness`)
      .then((r) => {
        if (active) setIssues(r.issues);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [role]);
  return (
    <U.Dialog
      open
      onOpenChange={(v) => {
        closeGuard.onOpenChange(v);
      }}
    >
      <U.DialogContent>
        <U.DialogHeader>
          <U.DialogTitle>Create a research pack</U.DialogTitle>
          <U.DialogDescription>
            {org.name} · A fixed copy will be created as a new revision.
          </U.DialogDescription>
        </U.DialogHeader>
        <div className="space-y-5">
          <Pick
            label="Role for this pack"
            value={role}
            onChange={(value) => {
              setRole(value);
              setError("");
            }}
            options={roleOptions}
            autoFocus
          />
          {checking ? (
            <p className="text-p4">
              Checking open items…
            </p>
          ) : issues.length ? (
            <U.Alert>
              <U.AlertTitle>
                Open items
              </U.AlertTitle>
              <U.AlertDescription>
                <ul className="list-disc pl-5 space-y-2 mt-3">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </U.AlertDescription>
            </U.Alert>
          ) : (
            <U.Alert>
              <U.AlertDescription>
                <strong>Open items:</strong> None
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
            disabled={
              busy || checking
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await post(`/roles/${role}/packs`, {});
                await onSaved();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create research pack"}
          </U.Button>
        </U.DialogFooter>
      </U.DialogContent>
      {closeGuard.confirmation}
    </U.Dialog>
  );
}
