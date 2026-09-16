import { useEffect, useState, type ReactNode, type FormEvent } from "react";
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
} from "../shared/types";
import { labels } from "../shared/types";
import { api, post, patch, download } from "./api";
import { ResearchWorkspacePage } from "./components/research-workspace-page";
import * as U from "./ui";
import { OrgSuggestions } from "./components/org-suggestions";
import {
  OccupationMatcher,
  type OccupationRecord,
} from "./components/occupation-matcher";
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
};
function Pick({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  label: string;
}) {
  return (
    <U.Select value={value} onValueChange={onChange}>
      <U.SelectTrigger aria-label={label} className="min-w-0">
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
/** A cited web page was refreshed and the quotation is gone; unreviewed since. */
function sourceChanged(f: Finding) {
  return (f.sourceChanges || []).some(
    (c) => !c.quoteFound && (!f.reviewedAt || f.reviewedAt < c.at),
  );
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
  render,
}: {
  title: string;
  description: string;
  fields: Field[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>, file?: File) => Promise<void>;
  submitLabel?: string;
  /** Extra content rendered below the fields, given the live values. */
  render?: (values: Record<string, string>) => ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.value || ""])),
  );
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(values, file);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <U.Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <U.DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <U.DialogHeader>
          <U.DialogTitle>{title}</U.DialogTitle>
          <U.DialogDescription>{description}</U.DialogDescription>
        </U.DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          {fields.map((f) => (
            <div key={f.name} className="space-y-2">
              <U.Label htmlFor={`field-${f.name}`}>
                {f.label}
                {f.required ? " *" : ""}
              </U.Label>
              {f.kind === "select" ? (
                <Pick
                  label={f.label}
                  value={values[f.name] || (undefined as any)}
                  onChange={(v) => setValues({ ...values, [f.name]: v })}
                  options={f.options || []}
                />
              ) : f.kind === "file" ? (
                <U.Input
                  id={`field-${f.name}`}
                  type="file"
                  required={f.required}
                  accept=".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg"
                  onChange={(e) => setFile(e.target.files?.[0])}
                />
              ) : f.kind === "textarea" ? (
                <U.Textarea
                  id={`field-${f.name}`}
                  required={f.required}
                  rows={4}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                />
              ) : (
                <U.Input
                  id={`field-${f.name}`}
                  required={f.required}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                />
              )}{" "}
              {f.hint && (
                <p className="text-p5 text-muted-foreground">{f.hint}</p>
              )}
            </div>
          ))}
          {render?.(values)}
          {error && (
            <U.Alert role="alert">
              <U.AlertDescription>{error}</U.AlertDescription>
            </U.Alert>
          )}
          <U.DialogFooter>
            <U.Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </U.Button>
            <U.Button type="submit" disabled={busy}>
              {busy ? "Saving…" : submitLabel}
            </U.Button>
          </U.DialogFooter>
        </form>
      </U.DialogContent>
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
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [modal, setModal] = useState<Modal>();
  const [evidence, setEvidence] = useState<Finding>();
  const [source, setSource] = useState<Source>();
  const [matcher, setMatcher] = useState<Role>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [roleId, setRoleId] = useState("all");
  const [evidenceMode, setEvidenceMode] = useState("findings");
  const [tier, setTier] = useState("power");
  const [busy, setBusy] = useState(false);
  const nav = (path: string) => {
    location.hash = path;
  };
  const reload = async () => {
    const [s, d] = await Promise.all([api("/session"), api("/workspace")]);
    setSession(s);
    setData(d);
    setError("");
  };
  useEffect(() => {
    const hash = () => {
      setRoute(location.hash.slice(1) || "/");
      setRoleId("all");
      setFilter("all");
      setSearch("");
    };
    window.addEventListener("hashchange", hash);
    void reload().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void reload().catch((e) => setError(e.message));
    }, 7000);
    return () => {
      window.removeEventListener("hashchange", hash);
      clearInterval(timer);
    };
  }, []);
  const run = async (fn: () => Promise<unknown>, message = "Saved") => {
    setBusy(true);
    try {
      await fn();
      await reload();
      U.toast({ title: message });
    } catch (e) {
      U.toast({
        title: "Could not complete the action",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };
  const parts = route.split("/").filter(Boolean);
  const org = data?.organisations.find((o) => o.id === parts[1]);
  const tab = parts[2] || "overview";
  const orgRoles = data?.roles.filter((r) => r.orgId === org?.id) || [];
  const relevant = (x: { orgId: string; roleId?: string }) =>
    x.orgId === org?.id &&
    (roleId === "all" || !x.roleId || x.roleId === roleId);
  const findings = data?.findings.filter(relevant) || [];
  const questions = data?.questions.filter(relevant) || [];
  const activities =
    data?.activities.filter(
      (a) => a.orgId === org?.id && (roleId === "all" || a.roleId === roleId),
    ) || [];
  const sources =
    data?.sources.filter(
      (s) =>
        s.orgId === org?.id &&
        (roleId === "all" || !s.roleIds.length || s.roleIds.includes(roleId)),
    ) || [];
  const packs =
    data?.packs.filter(
      (p) =>
        p.organisation.id === org?.id &&
        (roleId === "all" || p.role.id === roleId),
    ) || [];
  const jobs = data?.jobs.filter(relevant).slice().reverse() || [];
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
            label: "Division or business unit",
            value: o.division,
          },
          {
            name: "summary",
            label: "Organisation summary",
            value: o.summary,
            kind: "textarea",
            hint: "A working summary. Evidence-backed employer claims are recorded separately.",
          },
          {
            name: "brandNotes",
            label: "Brand guidance and asset notes",
            value: o.brandNotes,
            kind: "textarea",
          },
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
    const save = async (fn: () => Promise<unknown>) => {
      await fn();
      await reload();
    };
    const m = modal.item;
    if (modal.type === "organisation")
      return (
        <FormModal
          title={m ? "Edit organisation" : "Create organisation"}
          description="Confirm the employer’s identity. Existing organisations are checked before a new record is created."
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
            const created = m
              ? await patch(`/organisations/${m.id}`, {
                  ...v,
                  version: m.version,
                })
              : await post("/organisations", v);
            await reload();
            nav(`/org/${created.id}/overview`);
          }}
        />
      );
    if (modal.type === "role")
      return (
        <FormModal
          title={m ? "Edit role" : "Add a role"}
          description="Keep the employer’s actual title. Describe the work so occupational matches can be checked."
          fields={roleFields(m)}
          onClose={close}
          onSubmit={async (v) =>
            save(() =>
              m
                ? patch(`/roles/${m.id}`, { ...v, version: m.version })
                : post(`/organisations/${org!.id}/roles`, v),
            )
          }
        />
      );
    if (modal.type === "statement")
      return (
        <FormModal
          title="Add source material"
          description="Record a source passage or client statement. The original wording stays inspectable."
          fields={[
            { name: "title", label: "Source title", required: true },
            {
              name: "kind",
              label: "Source type",
              value: "statement",
              kind: "select",
              options: [
                ["statement", "Client or team statement"],
                ["document", "Document excerpt"],
                ["occupation", "Occupational reference"],
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
                ["client-confirmed", "Recorded client confirmation"],
                ["public-source", "Public source"],
              ],
            },
            { name: "locator", label: "Page, section or meeting reference" },
            scopeField,
          ]}
          onClose={close}
          onSubmit={async (v) =>
            save(() =>
              post(`/organisations/${org!.id}/sources`, {
                ...v,
                roleIds: v.roleId === "all" ? [] : [v.roleId],
              }),
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
            { name: "url", label: "Public page URL", required: true },
            scopeField,
          ]}
          onClose={close}
          submitLabel="Capture source"
          onSubmit={async (v) =>
            save(() =>
              post(`/organisations/${org!.id}/web-source`, {
                url: v.url,
                roleId: v.roleId === "all" ? undefined : v.roleId,
              }),
            )
          }
        />
      );
    if (modal.type === "upload")
      return (
        <FormModal
          title="Upload source material"
          description="PDF, DOCX, TXT, Markdown, PNG or JPEG. Maximum 10 MB. Uploaded assets start with unconfirmed usage permission."
          fields={[
            { name: "title", label: "Title (optional)" },
            {
              name: "file",
              label: "Document or workplace image",
              kind: "file",
              required: true,
            },
            {
              name: "caption",
              label: "Context or image caption",
              kind: "textarea",
              hint: "For photos, describe the location, relevant role and anything the image cannot establish.",
            },
            scopeField,
          ]}
          onClose={close}
          submitLabel="Upload"
          onSubmit={async (v, file) => {
            if (!file) throw new Error("Choose a file.");
            const form = new FormData();
            form.append("file", file);
            form.append("title", v.title);
            form.append("caption", v.caption);
            if (v.roleId !== "all") form.append("roleId", v.roleId);
            await save(() =>
              api(`/organisations/${org!.id}/upload`, {
                method: "POST",
                body: form,
              }),
            );
          }}
        />
      );
    if (modal.type === "finding")
      return (
        <FormModal
          title="Record a finding"
          description="Capture one claim. Factual findings require an exact quotation from a source in this organisation."
          fields={[
            {
              name: "claim",
              label: "Finding",
              required: true,
              kind: "textarea",
            },
            {
              name: "kind",
              label: "Classification",
              value: "company",
              kind: "select",
              options: [
                ["company", "Employer fact"],
                ["occupation", "Occupational context"],
                ["proposal", "Design proposal"],
              ],
            },
            {
              name: "sourceId",
              label: "Supporting source",
              value:
                sources.find((s) => s.text.trim() && s.kind !== "occupation")
                  ?.id ||
                sources.find((s) => s.text.trim())?.id ||
                "none",
              kind: "select",
              options: [
                ["none", "No source (design proposals only)"],
                ...sources.map(
                  (s) =>
                    [
                      s.id,
                      s.text.trim() ? s.title : `${s.title} (no captured text)`,
                    ] as [string, string],
                ),
              ],
              hint: "Required for employer facts and occupational context. Images have no captured text and cannot supply a quotation.",
            },
            {
              name: "quote",
              label: "Exact supporting passage",
              kind: "textarea",
              hint: "Required for employer facts and occupational context; optional for design proposals. Copy the passage word for word from the source’s captured text. Line breaks and spacing do not matter; the wording must be identical.",
            },
            {
              name: "locator",
              label: "Page or section",
              value: "Source excerpt",
            },
            {
              name: "rationale",
              label: "Scope or uncertainty",
              kind: "textarea",
            },
            scopeField,
          ]}
          onClose={close}
          onSubmit={async (v) => {
            // Explain the evidence rules before the request so a missing
            // passage reads as guidance rather than a validation code.
            const chosen =
              v.sourceId === "none"
                ? undefined
                : sources.find((s) => s.id === v.sourceId);
            // A design proposal needs no evidence: the pre-selected source is
            // ignored unless a passage was actually pasted for it.
            const source =
              v.kind === "proposal" && !v.quote.trim() ? undefined : chosen;
            if (v.kind !== "proposal" && !source)
              throw new Error(
                "Employer facts and occupational context need a supporting source. Choose one and paste the exact passage, or classify the finding as a design proposal.",
              );
            if (source && !source.text.trim())
              throw new Error(
                `“${source.title}” has no captured text, so it cannot supply a quotation. Images are not read automatically; cite a web page or text document instead.`,
              );
            if (source && !v.quote.trim())
              throw new Error(
                `Paste the exact supporting passage from “${source.title}”.`,
              );
            await save(() =>
              post(`/organisations/${org!.id}/findings`, {
                claim: v.claim,
                kind: v.kind,
                rationale: v.rationale,
                roleId: v.roleId === "all" ? undefined : v.roleId,
                citations: source
                  ? [
                      {
                        sourceId: source.id,
                        quote: v.quote,
                        locator: v.locator,
                      },
                    ]
                  : [],
              }),
            );
          }}
        />
      );
    if (modal.type === "question")
      return (
        <FormModal
          title={m ? "Respond to question" : "Add a client question"}
          description="An answer does not automatically verify a finding. Record its source and review affected evidence separately."
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
                      ["client", "Ask the client"],
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
                      ["false", "No — carry into client review"],
                      ["true", "Yes — identity or scope must be resolved"],
                    ],
                  },
                  { name: "assignee", label: "Assigned to" },
                  scopeField,
                ]
          }
          onClose={close}
          onSubmit={async (v) =>
            save(() =>
              m
                ? patch(`/questions/${m.id}`, { ...v, version: m.version })
                : post(`/organisations/${org!.id}/questions`, {
                    ...v,
                    blocking: v.blocking === "true",
                    roleId: v.roleId === "all" ? undefined : v.roleId,
                  }),
            )
          }
        />
      );
    if (modal.type === "activity")
      return (
        <FormModal
          title="Propose an activity"
          description="A candidate for storyboard design, not an approved task or employer procedure."
          fields={[
            {
              ...scopeField,
              options: roleOptions.filter(([id]) => id !== "all"),
              value: roleId === "all" ? orgRoles[0]?.id : roleId,
            },
            { name: "title", label: "Activity title", required: true },
            {
              name: "action",
              label: "What the learner does",
              required: true,
              kind: "textarea",
            },
            { name: "output", label: "What they produce", required: true },
            {
              name: "materials",
              label: "Materials needed",
              required: true,
              kind: "textarea",
            },
            {
              name: "learning",
              label: "What this reveals about the role",
              required: true,
              kind: "textarea",
            },
            {
              name: "confirmation",
              label: "What the client must confirm",
              kind: "textarea",
            },
          ]}
          onClose={close}
          onSubmit={async (v) =>
            save(() => post(`/organisations/${org!.id}/activities`, v))
          }
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
            save(() =>
              post(`/roles/${m.id}/occupations`, {
                ...v,
                version: m.version,
                activities: v.activities.split("\n").filter(Boolean),
                skills: v.skills.split("\n").filter(Boolean),
                knowledge: v.knowledge.split("\n").filter(Boolean),
                workContext: v.workContext.split("\n").filter(Boolean),
              }),
            )
          }
        />
      );
    if (modal.type === "member")
      return (
        <FormModal
          title="Manage team access"
          description="Use the stable user ID from your new Clerk application. This grants access only to this research workspace."
          fields={[
            {
              name: "userId",
              label: "Clerk user ID",
              value: m?.userId,
              required: true,
            },
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
            {
              name: "active",
              label: "Access",
              value: m?.active === false ? "false" : "true",
              kind: "select",
              options: [
                ["true", "Active"],
                ["false", "Revoked"],
              ],
            },
          ]}
          onClose={close}
          onSubmit={async (v) =>
            save(() => post("/members", { ...v, active: v.active === "true" }))
          }
        />
      );
    if (modal.type === "pack")
      return (
        <PackModal
          org={org!}
          roles={orgRoles}
          roleOptions={roleOptions.filter(([id]) => id !== "all")}
          initialRole={roleId === "all" ? orgRoles[0]?.id : roleId}
          canReady={session?.role !== "researcher"}
          onClose={close}
          onSaved={reload}
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
              "Your shared employer library",
            ],
            [
              "Needs review",
              data?.findings.filter(
                (f) =>
                  f.review === "unreviewed" || f.review === "clarification",
              ).length || 0,
              "Findings waiting for a closer look",
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
                    ["unreviewed", "Needs review"],
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
            { id: "owner", header: "Owner", accessor: (o) => o.owner },
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
            <Empty
              title="Your research starts here"
              description="Create an organisation to bring together employer evidence, role research and questions for the client."
              action={
                <U.Button
                  variant="outline"
                  onClick={() => setModal({ type: "organisation" })}
                >
                  Create your first organisation
                </U.Button>
              }
            />
          }
        />
      </>
    );
  };
  const researchButton = (
    <U.Button
      disabled={busy}
      onClick={() =>
        void run(
          () =>
            post(`/organisations/${org!.id}/research`, {
              tier,
              roleId: roleId === "all" ? undefined : roleId,
            }),
          "Research queued",
        )
      }
    >
      <U.IconMagicWand size={20} />
      Start research
    </U.Button>
  );
  function renderOverview() {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <U.Card className="lg:col-span-2">
            <U.CardHeader>
              <U.CardTitle>About this organisation</U.CardTitle>
              <U.CardDescription>
                Working context for the team. Check individual claims in
                Evidence.
              </U.CardDescription>
            </U.CardHeader>
            <U.CardContent className="space-y-5">
              <p className="text-p3 whitespace-pre-wrap">
                {org!.summary ||
                  "Add a short overview, then capture sources to build the evidence behind it."}
              </p>
              <div className="flex flex-wrap gap-5 text-p4 text-muted-foreground">
                <span className="inline-flex gap-2 items-center">
                  <U.IconLocationPin size={20} />
                  {org!.country}
                </span>
                <span className="inline-flex gap-2 items-center">
                  <U.IconWork size={20} />
                  {org!.division || "Whole organisation"}
                </span>
              </div>
              {org!.website && (
                <a
                  className="text-p4 underline underline-offset-4 break-all"
                  href={org!.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  {org!.website}
                </a>
              )}
              <div>
                <U.Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModal({ type: "organisation", item: org })}
                >
                  Edit organisation
                </U.Button>
              </div>
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
              <p className="text-p5">
                A ready pack is a research handover, not employer approval.
              </p>
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
                    onClick={() => {
                      nav(`/org/${org!.id}/roles`);
                    }}
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
        <U.Card>
          <U.CardHeader>
            <U.CardTitle>Research runs</U.CardTitle>
            <U.CardDescription>
              Completed evidence is retained if a source or provider fails.
            </U.CardDescription>
          </U.CardHeader>
          <U.CardContent>
            {!jobs.length ? (
              <p className="text-p4 text-muted-foreground">
                No research runs yet. Add materials or start from the official
                website.
              </p>
            ) : (
              <div className="space-y-4">
                {jobs.map((j) => (
                  <div
                    key={j.id}
                    className="border border-border rounded-xl p-4 space-y-3"
                  >
                    <div className="flex flex-wrap gap-3 justify-between">
                      <div>
                        <p className="text-p3 font-medium">
                          {j.roleId
                            ? orgRoles.find((r) => r.id === j.roleId)?.title
                            : "Organisation research"}
                        </p>
                        <p className="text-p5 text-muted-foreground">
                          {j.stage} · {date(j.createdAt)}
                        </p>
                      </div>
                      <Status value={j.status} />
                    </div>
                    {j.runs.map((r) => (
                      <p key={r.id} className="text-p5">
                        {r.model}: {r.status} · {r.findings} findings ·{" "}
                        {r.inputTokens + r.outputTokens} tokens
                      </p>
                    ))}
                    {j.errors.length > 0 && (
                      <details>
                        <summary className="text-p4 cursor-pointer">
                          {j.errors.length} research limitations
                        </summary>
                        <ul className="text-p5 space-y-2 mt-3 list-disc pl-5">
                          {j.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {["queued", "researching"].includes(j.status) && (
                      <U.Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => post(`/jobs/${j.id}/cancel`, {}),
                            "Run cancelled",
                          )
                        }
                      >
                        Cancel run
                      </U.Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </U.CardContent>
        </U.Card>
      </div>
    );
  }
  function renderEvidence() {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <U.Button
              variant={evidenceMode === "findings" ? "secondary" : "ghost"}
              onClick={() => setEvidenceMode("findings")}
            >
              Findings ({findings.length})
            </U.Button>
            <U.Button
              variant={evidenceMode === "sources" ? "secondary" : "ghost"}
              onClick={() => setEvidenceMode("sources")}
            >
              Sources & assets ({sources.length})
            </U.Button>
          </div>
          <U.Button
            variant="outline"
            onClick={() =>
              setModal({
                type: evidenceMode === "findings" ? "finding" : "upload",
              })
            }
          >
            <U.IconAdd size={20} />
            {evidenceMode === "findings" ? "Record finding" : "Upload material"}
          </U.Button>
        </div>
        {evidenceMode === "sources" ? (
          <>
            <div className="flex flex-wrap gap-3">
              <U.Button
                variant="outline"
                size="sm"
                onClick={() => setModal({ type: "web" })}
              >
                Capture website page
              </U.Button>
              <U.Button
                variant="outline"
                size="sm"
                onClick={() => setModal({ type: "statement" })}
              >
                Record passage or client statement
              </U.Button>
            </div>
            <U.DataTable
              data={sources}
              getRowId={(s) => s.id}
              defaultPageSize={8}
              showColumnVisibility={false}
              columns={[
                {
                  id: "title",
                  header: "Source material",
                  accessor: (s) => s.title,
                  sortable: true,
                  cell: (s) => (
                    <U.Button
                      variant="link"
                      className="h-auto p-0 text-left whitespace-normal"
                      onClick={() => setSource(s)}
                    >
                      {s.title}
                    </U.Button>
                  ),
                },
                {
                  id: "kind",
                  header: "Type",
                  accessor: (s) =>
                    ({
                      web: "Website",
                      document: "Document",
                      statement: "Statement",
                      image: "Workplace image",
                      occupation: "Occupational reference",
                    })[s.kind],
                },
                {
                  id: "date",
                  header: "Captured",
                  cell: (s) => (
                    <span className="text-p5">{date(s.retrievedAt)}</span>
                  ),
                },
                {
                  id: "permission",
                  header: "Usage",
                  cell: (s) => <Status value={s.permission} />,
                },
                {
                  id: "view",
                  header: "",
                  cell: (s) => (
                    <U.Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSource(s)}
                    >
                      Inspect
                    </U.Button>
                  ),
                },
              ]}
              empty={
                <Empty
                  title="Bring your sources together"
                  description="Capture a public page, upload a document or photo, or record what the client has told you. Each source stays linked to its findings."
                />
              }
            />
          </>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <U.Input
                aria-label="Search findings"
                placeholder="Search findings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:max-w-sm"
              />
              <div className="sm:w-60">
                <Pick
                  label="Finding filter"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    ["all", "All findings"],
                    ["unreviewed", "Needs review"],
                    ["accepted", "Accepted for drafting"],
                    ["clarification", "Needs clarification"],
                    ["rejected", "Excluded"],
                  ]}
                />
              </div>
            </div>
            <div className="space-y-3">
              {findings
                .filter(
                  (f) =>
                    (filter === "all" || f.review === filter) &&
                    f.claim.toLowerCase().includes(search.toLowerCase()),
                )
                .map((f) => (
                  <U.Card key={f.id}>
                    <U.CardContent className="p-5">
                      <div className="flex flex-wrap gap-2 mb-3">
                        <U.Badge variant="outline">{labels[f.kind]}</U.Badge>
                        <Status value={f.review} />
                        {sourceChanged(f) && (
                          <U.Badge variant="destructive">
                            Source changed — re-review
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
                          {f.citations.length} evidence reference
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
            {!findings.length && (
              <U.Card>
                <Empty
                  title="Evidence comes before the story"
                  description="Add source material, then run research or record a finding yourself. Every factual claim needs an exact supporting passage."
                  action={
                    <U.Button
                      variant="outline"
                      onClick={() => setEvidenceMode("sources")}
                    >
                      Add source material
                    </U.Button>
                  }
                />
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
                    <U.Badge
                      variant={
                        r.reviewState === "ready" ? "default" : "outline"
                      }
                    >
                      {labels[r.reviewState || "draft"]}
                    </U.Badge>
                    {r.reviewState !== "in-review" && (
                      <U.Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              post(`/roles/${r.id}/review-state`, {
                                state: "in-review",
                                version: r.version,
                              }),
                            "Sent for review",
                          )
                        }
                      >
                        {r.reviewState === "ready"
                          ? "Reopen for review"
                          : "Send for review"}
                      </U.Button>
                    )}
                    {r.reviewState === "in-review" &&
                      session?.role !== "researcher" && (
                        <U.Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                post(`/roles/${r.id}/review-state`, {
                                  state: "ready",
                                  version: r.version,
                                }),
                              "Role profile marked ready",
                            )
                          }
                        >
                          Mark ready
                        </U.Button>
                      )}
                    {r.reviewState === "in-review" && (
                      <U.Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              post(`/roles/${r.id}/review-state`, {
                                state: "draft",
                                version: r.version,
                              }),
                            "Returned to draft",
                          )
                        }
                      >
                        Return to draft
                      </U.Button>
                    )}
                    <U.Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setModal({ type: "role", item: r })}
                    >
                      Edit role
                    </U.Button>
                  </div>
                </div>
                {r.reviewChanged && (
                  <U.Alert className="mt-3">
                    <U.AlertDescription>
                      Content changed after this profile was marked ready, so it
                      is back in draft. Send it for review again before creating
                      a ready snapshot.
                    </U.AlertDescription>
                  </U.Alert>
                )}
                {r.reviewState === "in-review" &&
                  session?.role === "researcher" && (
                    <p className="text-p5 text-muted-foreground mt-2">
                      Waiting for a reviewer to confirm readiness. Only
                      reviewers and administrators can mark a profile ready.
                    </p>
                  )}
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
                    {r.boundaries || "Needs client confirmation."}
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
            description="Add a role to connect responsibilities, occupational context and activity candidates."
          />
        )}
        <div className="flex flex-wrap justify-between gap-3 items-center">
          <div>
            <h2 className="text-h5">Activity candidates</h2>
            <p className="text-p4 text-muted-foreground mt-1">
              Proposals for the storyboard designer. Client validation still
              follows.
            </p>
          </div>
          <U.Button
            variant="outline"
            disabled={!orgRoles.length}
            onClick={() => setModal({ type: "activity" })}
          >
            Propose activity
          </U.Button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {activities.map((a, i) => (
            <U.Card key={a.id}>
              <U.CardHeader>
                <div className="flex justify-between gap-2 mb-3">
                  <U.Badge variant="outline">Candidate {i + 1}</U.Badge>
                  <Status value={a.review} />
                </div>
                <U.CardTitle>{a.title}</U.CardTitle>
                <U.CardDescription>
                  {orgRoles.find((r) => r.id === a.roleId)?.title}
                </U.CardDescription>
              </U.CardHeader>
              <U.CardContent className="space-y-4">
                <p className="text-p3">{a.action}</p>
                <dl className="space-y-3 text-p4">
                  {[
                    ["Learner output", a.output],
                    ["Materials", a.materials],
                    ["What it reveals", a.learning],
                    [
                      "Confirm with the client",
                      a.confirmation || "Required before storyboard approval",
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="font-semibold">{label}</dt>
                      <dd className="text-muted-foreground mt-1">{value}</dd>
                    </div>
                  ))}
                </dl>
                {a.findingIds.length > 0 && (
                  <p className="text-p5 text-muted-foreground">
                    Based on {a.findingIds.length} evidence findings.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <U.Button
                    variant="outline"
                    size="sm"
                    disabled={busy || a.review === "accepted"}
                    onClick={() =>
                      void run(
                        () =>
                          patch(`/activities/${a.id}`, {
                            version: a.version,
                            review: "accepted",
                            confirmation: a.confirmation,
                          }),
                        "Candidate accepted for drafting",
                      )
                    }
                  >
                    Accept for drafting
                  </U.Button>
                  <U.Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || a.review === "rejected"}
                    onClick={() =>
                      void run(
                        () =>
                          patch(`/activities/${a.id}`, {
                            version: a.version,
                            review: "rejected",
                            confirmation: a.confirmation,
                          }),
                        "Candidate excluded",
                      )
                    }
                  >
                    Exclude
                  </U.Button>
                </div>
              </U.CardContent>
            </U.Card>
          ))}
        </div>
        {!activities.length && orgRoles.length > 0 && (
          <U.Card>
            <Empty
              title="Turn real work into possibilities"
              description="Run role research to generate candidates, or add a proposal grounded in the evidence you already have."
            />
          </U.Card>
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
            <p className="text-p4 text-muted-foreground mt-2">
              Keep unknowns explicit. Defer what the client needs to confirm.
            </p>
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
                  <U.Badge variant="outline">Blocks readiness</U.Badge>
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
                <U.Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModal({ type: "question", item: q })}
                >
                  Respond or defer
                </U.Button>
              </div>
            </U.CardContent>
          </U.Card>
        ))}
        {!questions.length && (
          <U.Card>
            <Empty
              title="No unanswered questions recorded"
              description="When something is uncertain, capture the question and explain which design decision it affects."
            />
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
            Create snapshot
          </U.Button>
        </div>
        <U.Alert>
          <U.AlertDescription>
            Each snapshot has a separate revision and export-schema version.
            Later edits never change it. Research readiness is not employer
            approval.
          </U.AlertDescription>
        </U.Alert>
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
                    {date(p.createdAt)} · {p.findings.length} findings ·{" "}
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
                </div>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-p4">
                  Inspect snapshot
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
            <Empty
              title="Your research, ready to hand over"
              description="Create a draft snapshot at any point. A reviewer can mark a pack ready after the evidence and activity review is complete."
            />
          </U.Card>
        )}
      </div>
    );
  }
  const renderSettings = () => (
    <>
      {pageHeading(
        "Workspace",
        "Team & connections",
        "Access is managed independently from Employer Intelligence.",
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <U.Card>
          <U.CardHeader>
            <U.CardTitle>Research connections</U.CardTitle>
            <U.CardDescription>
              Provider keys stay on the server. The selected model does not
              grant approval.
            </U.CardDescription>
          </U.CardHeader>
          <U.CardContent className="space-y-4">
            {[
              ["economy", "Economy", "Gemini · economical evidence extraction"],
              ["power", "Power", "Claude Sonnet · research synthesis"],
              [
                "max",
                "Max",
                "Fable + GPT-6 · independent analysis of shared sources",
              ],
            ].map(([id, label, desc]) => (
              <div className="flex justify-between gap-3" key={id}>
                <div>
                  <p className="text-p3 font-medium">{label}</p>
                  <p className="text-p5 text-muted-foreground">{desc}</p>
                </div>
                <U.Badge variant="outline">
                  {session?.providers[id] ? "Configured" : "Needs setup"}
                </U.Badge>
              </div>
            ))}
          </U.CardContent>
        </U.Card>
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
          <U.Button variant="ghost" size="sm" onClick={() => nav("/settings")}>
            Team
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
                active={route !== "/settings"}
                onClick={() => nav("/")}
              />
              <U.SidebarNavItem
                icon={<U.IconSettings size={20} />}
                label="Team & connections"
                active={route === "/settings"}
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
              {error ? (
                <U.Alert role="alert">
                  <U.AlertTitle>Workspace unavailable</U.AlertTitle>
                  <U.AlertDescription>{error}</U.AlertDescription>
                  <U.Button
                    variant="outline"
                    className="mt-4"
                    onClick={() =>
                      void reload().catch((e) => setError(e.message))
                    }
                  >
                    Retry
                  </U.Button>
                </U.Alert>
              ) : !data ? (
                <div className="space-y-5">
                  <U.Skeleton className="h-16 w-1/2" />
                  <U.Skeleton className="h-72 w-full" />
                </div>
              ) : route === "/settings" ? (
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
                  <U.Button
                    variant="ghost"
                    size="sm"
                    className="mb-5 self-start"
                    onClick={() => nav("/")}
                  >
                    <U.IconArrowLeft size={16} />
                    Organisations
                  </U.Button>
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 mb-6">
                    <div className="flex items-center gap-4">
                      <U.PartnerAvatar
                        fallback={initials(org.name)}
                        alt={org.name}
                        size="lg"
                      />
                      <div>
                        <p className="text-label-3 uppercase text-muted-foreground">
                          Organisation workspace
                        </p>
                        <h1 className="text-h3-mobile lg:text-h3 mt-1">
                          {org.name}
                        </h1>
                        <p className="text-p4 text-muted-foreground mt-1">
                          {org.country} · {org.owner}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="sm:w-44">
                        <Pick
                          label="Research tier"
                          value={tier}
                          onChange={setTier}
                          options={[
                            ["economy", "Economy"],
                            ["power", "Power"],
                            ["max", "Max · dual analysis"],
                          ]}
                        />
                      </div>
                      {researchButton}
                    </div>
                  </div>
                  <U.PartnerTabs
                    value={tab}
                    onValueChange={(v) => nav(`/org/${org.id}/${v}`)}
                  >
                    <U.PartnerTabsList className="w-full justify-start overflow-x-auto mb-6">
                      {[
                        ["overview", "Overview"],
                        ["evidence", "Evidence"],
                        ["roles", "Roles"],
                        ["questions", "Questions"],
                        ["packs", "Research packs"],
                      ].map(([id, name]) => (
                        <U.PartnerTabsTrigger key={id} value={id}>
                          {name}
                        </U.PartnerTabsTrigger>
                      ))}
                    </U.PartnerTabsList>
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
                        <span>
                          {
                            findings.filter((f) => f.review === "accepted")
                              .length
                          }{" "}
                          accepted findings
                        </span>
                        <span>·</span>
                        <span>
                          {
                            questions.filter((q) => q.status !== "answered")
                              .length
                          }{" "}
                          open questions
                        </span>
                      </div>
                    </div>
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
      {evidence && data && (
        <EvidencePanel
          // Display follows the live record (a refresh may flag it while
          // open); the save still carries the version seen when opened, so a
          // change made meanwhile is rejected with 409 rather than overwritten.
          finding={data.findings.find((f) => f.id === evidence.id) || evidence}
          sources={data.sources}
          onClose={() => setEvidence(undefined)}
          onSave={async (v) => {
            await patch(`/findings/${evidence.id}`, {
              ...v,
              version: evidence.version,
            });
            await reload();
            setEvidence(undefined);
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
          onRefresh={async () => {
            const result: RefreshResult = await post(
              `/sources/${source.id}/refresh`,
              {},
            );
            await reload();
            // Superseding bumps this capture's version; the panel's own refresh
            // is not a conflict, so carry the new version for a later save.
            setSource({ ...source, version: source.version + 1 });
            return result;
          }}
          onClose={() => setSource(undefined)}
          onSave={async (v) => {
            await patch(`/sources/${source.id}`, {
              ...v,
              version: source.version,
              roleIds: source.roleIds,
            });
            await reload();
            setSource(undefined);
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
  onClose,
  onSave,
}: {
  finding: Finding;
  sources: Source[];
  onClose: () => void;
  onSave: (v: any) => Promise<void>;
}) {
  const [claim, setClaim] = useState(f.claim);
  const [kind, setKind] = useState(f.kind);
  const [status, setStatus] = useState(f.review);
  const [rationale, setRationale] = useState(f.rationale);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <U.Sheet
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <U.SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <U.SheetHeader>
          <U.SheetTitle>Inspect the evidence</U.SheetTitle>
          <U.SheetDescription>
            Acceptance means suitable for drafting. It does not mean the
            employer has approved it.
          </U.SheetDescription>
        </U.SheetHeader>
        <div className="space-y-6 py-6">
          {sourceChanged(f) && (
            <U.Alert>
              <U.AlertTitle>The cited page changed</U.AlertTitle>
              <U.AlertDescription>
                A newer capture no longer contains this exact quotation. Check
                the passage against the new capture before saving a review; the
                finding blocks readiness until it is reviewed again.
              </U.AlertDescription>
            </U.Alert>
          )}
          <div className="space-y-2">
            <U.Label htmlFor="review-claim">Finding</U.Label>
            <U.Textarea
              id="review-claim"
              rows={4}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
            />
          </div>
          <Pick
            label="Classification"
            value={kind}
            onChange={(v) => setKind(v as any)}
            options={[
              ["company", "Employer fact"],
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
                      Evidence basis:{" "}
                      {s?.verification === "client-confirmed"
                        ? "Recorded client confirmation"
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
            <U.Textarea
              id="review-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>
          <Pick
            label="Review decision"
            value={status}
            onChange={(v) => setStatus(v as any)}
            options={[
              ["unreviewed", "Needs review"],
              ["accepted", "Accept for drafting"],
              ["clarification", "Needs clarification"],
              ["rejected", "Exclude from the pack"],
            ]}
          />
          {error && (
            <U.Alert role="alert">
              <U.AlertDescription>{error}</U.AlertDescription>
            </U.Alert>
          )}
          <U.Button
            disabled={busy || !claim.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({ claim, kind, review: status, rationale });
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
    </U.Sheet>
  );
}
interface RefreshResult {
  source: Source;
  previousId: string;
  changed: boolean;
  added: string[];
  removed: string[];
  affectedFindingIds: string[];
}
function SourcePanel({
  source: s,
  onClose,
  onSave,
  onRefresh,
}: {
  source: Source;
  onClose: () => void;
  onSave: (v: any) => Promise<void>;
  onRefresh: () => Promise<RefreshResult>;
}) {
  const [permission, setPermission] = useState(s.permission);
  const [caption, setCaption] = useState(s.caption || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState("");
  const [refresh, setRefresh] = useState<RefreshResult>();
  const diff =
    refresh || (s.captureDiff ? { ...s.captureDiff, source: s } : undefined);
  useEffect(() => {
    if (s.kind !== "image") return;
    let url = "";
    let live = true;
    fetch(`/api/sources/${s.id}/file`)
      .then((r) => {
        if (!r.ok) throw new Error("Cannot load image");
        return r.blob();
      })
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
        if (!v && !busy) onClose();
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
          {s.kind === "web" && s.url && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {s.supersededBy ? (
                  <U.Badge variant="outline">
                    Superseded by a newer capture
                  </U.Badge>
                ) : (
                  <U.Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError("");
                      onRefresh()
                        .then(setRefresh)
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {busy ? "Refreshing…" : "Refresh capture"}
                  </U.Button>
                )}
                {s.supersedes && (
                  <U.Badge variant="outline">
                    Refreshed from an earlier capture
                  </U.Badge>
                )}
                <span className="text-p5 text-muted-foreground">
                  Captured {new Date(s.retrievedAt).toLocaleString()}
                </span>
              </div>
              {diff && (
                <U.Alert>
                  <U.AlertDescription>
                    <p className="text-p4 font-medium">
                      {diff.changed
                        ? `${refresh ? "The page changed." : "This capture differs from the one it refreshed."} ${diff.affectedFindingIds.length} finding${diff.affectedFindingIds.length === 1 ? "" : "s"} cite${diff.affectedFindingIds.length === 1 ? "s" : ""} passages that no longer appear and ${diff.affectedFindingIds.length === 1 ? "was" : "were"} flagged for re-review.`
                        : refresh
                          ? "No text change since the previous capture. A new capture was recorded with today’s date."
                          : "No text change against the capture this one refreshed."}
                    </p>
                    {refresh && (
                      <p className="text-p5 mt-1">
                        This capture is kept unchanged; existing quotations
                        still refer to it. New findings should cite the new
                        capture.
                      </p>
                    )}
                    {diff.removed.length > 0 && (
                      <div className="mt-3">
                        <p className="text-label-3">
                          Removed ({diff.removed.length})
                        </p>
                        {diff.removed.slice(0, 8).map((t, i) => (
                          <p key={i} className="text-p5 line-through">
                            {t}
                          </p>
                        ))}
                      </div>
                    )}
                    {diff.added.length > 0 && (
                      <div className="mt-3">
                        <p className="text-label-3">
                          Added ({diff.added.length})
                        </p>
                        {diff.added.slice(0, 8).map((t, i) => (
                          <p key={i} className="text-p5">
                            {t}
                          </p>
                        ))}
                      </div>
                    )}
                  </U.AlertDescription>
                </U.Alert>
              )}
            </div>
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
            <U.Textarea
              id="source-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <Pick
            label="Usage permission"
            value={permission}
            onChange={(v) => setPermission(v as any)}
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
            <U.Alert role="alert">
              <U.AlertDescription>{error}</U.AlertDescription>
            </U.Alert>
          )}
          <U.Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({ permission, caption });
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
    </U.Sheet>
  );
}
function PackModal({
  org,
  roles,
  roleOptions,
  initialRole,
  canReady,
  onClose,
  onSaved,
}: {
  org: Organisation;
  roles: Role[];
  roleOptions: [string, string][];
  initialRole: string;
  canReady: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState(initialRole);
  const [status, setStatus] = useState("draft");
  const [issues, setIssues] = useState<string[]>([]);
  const reviewState = roles.find((r) => r.id === role)?.reviewState || "draft";
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
        if (!v && !busy) onClose();
      }}
    >
      <U.DialogContent>
        <U.DialogHeader>
          <U.DialogTitle>Create a research snapshot</U.DialogTitle>
          <U.DialogDescription>
            {org.name} · The content will be frozen as a new revision.
          </U.DialogDescription>
        </U.DialogHeader>
        <div className="space-y-5">
          <Pick
            label="Role for this pack"
            value={role}
            onChange={setRole}
            options={roleOptions}
          />
          <Pick
            label="Pack status"
            value={status}
            onChange={setStatus}
            options={
              canReady
                ? [
                    ["draft", "Draft research pack"],
                    ["ready", "Ready for storyboard drafting"],
                  ]
                : [["draft", "Draft research pack"]]
            }
          />
          {status === "ready" && (
            <p className="text-p5 text-muted-foreground">
              Role profile review state: <strong>{labels[reviewState]}</strong>.{" "}
              {reviewState === "ready"
                ? "The reviewed content will be frozen as this snapshot."
                : "A ready snapshot needs the role profile marked ready by a reviewer after readiness checks pass."}
            </p>
          )}
          {checking ? (
            <p className="text-p4">Checking readiness…</p>
          ) : issues.length ? (
            <U.Alert>
              <U.AlertTitle>Before marking ready</U.AlertTitle>
              <U.AlertDescription>
                <ul className="list-disc pl-5 space-y-2 mt-3">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <p className="mt-3">
                  You can still create a clearly labelled draft.
                </p>
              </U.AlertDescription>
            </U.Alert>
          ) : (
            <U.Alert>
              <U.AlertDescription>
                Readiness checks passed. Client questions remain in the
                handover; this is not employer approval.
              </U.AlertDescription>
            </U.Alert>
          )}
          {error && (
            <p role="alert" className="text-p4 text-destructive">
              {error}
            </p>
          )}
        </div>
        <U.DialogFooter>
          <U.Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </U.Button>
          <U.Button
            disabled={
              busy ||
              checking ||
              (status === "ready" &&
                (issues.length > 0 || reviewState !== "ready"))
            }
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/roles/${role}/packs`, { status });
                await onSaved();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create immutable snapshot"}
          </U.Button>
        </U.DialogFooter>
      </U.DialogContent>
    </U.Dialog>
  );
}
