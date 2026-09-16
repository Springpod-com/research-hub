import { useEffect, useState } from "react";
import { api } from "../api";
import * as U from "../ui";
import type { Member, ModelSlot } from "../../shared/types";

type Slot = {
  slot: ModelSlot;
  tier: "economy" | "power" | "max";
  provider: "gemini" | "anthropic" | "openai";
  providerLabel: string;
  label: string;
  description: string;
  envVar: string;
  model: string | null;
  source: "workspace" | "environment" | "none";
  problem: string | null;
  environmentModel: string | null;
  access: boolean;
  options: { id: string; note: string }[];
};
export type ResearchSettingsView = {
  slots: Slot[];
  tiers: Record<"economy" | "power" | "max", boolean>;
  prompt: {
    instructions: string;
    version: number;
    updatedAt?: string;
    updatedBy?: string;
    isDefault: boolean;
  };
  defaultInstructions: string;
  contract: string;
  contextNote: string;
};

const TIER_NAME = { economy: "Economy", power: "Power", max: "Max" } as const;
const OTHER = "__other__";
const fmt = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function ModelEditor({
  slot,
  onSaved,
  onCancel,
}: {
  slot: Slot;
  onSaved: (view: ResearchSettingsView) => void;
  onCancel: () => void;
}) {
  const listed = slot.options.some((o) => o.id === slot.model);
  const [choice, setChoice] = useState(
    slot.model && listed ? slot.model : slot.model ? OTHER : "",
  );
  const [other, setOther] = useState(slot.model && !listed ? slot.model : "");
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState("");
  const chosen = choice === OTHER ? other.trim() : choice;
  const save = async (model: string, mode: "save" | "reset") => {
    setBusy(mode);
    setError("");
    try {
      const view = await api<ResearchSettingsView>(
        `/research-settings/models/${slot.slot}`,
        { method: "PUT", body: JSON.stringify({ model }) },
      );
      U.toast({
        title: model
          ? `${slot.label} now uses ${model}`
          : `${slot.label} uses the environment default again`,
        description: model
          ? "The model answered a live verification request before the change was saved."
          : undefined,
      });
      onSaved(view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            className="text-p5 text-muted-foreground"
            htmlFor={`${slot.slot}-model`}
          >
            Model for {slot.label} ({slot.providerLabel})
          </label>
          <U.Select value={choice} onValueChange={setChoice}>
            <U.SelectTrigger
              id={`${slot.slot}-model`}
              aria-label={`Model for ${slot.label}`}
              className="w-full"
            >
              <U.SelectValue placeholder="Choose a model" />
            </U.SelectTrigger>
            <U.SelectContent>
              {slot.options.map((o) => (
                <U.SelectItem key={o.id} value={o.id}>
                  {o.id} · {o.note}
                </U.SelectItem>
              ))}
              <U.SelectItem value={OTHER}>Another model ID…</U.SelectItem>
            </U.SelectContent>
          </U.Select>
        </div>
        {choice === OTHER && (
          <div className="space-y-1">
            <label
              className="text-p5 text-muted-foreground"
              htmlFor={`${slot.slot}-other`}
            >
              Exact model ID
            </label>
            <U.Input
              id={`${slot.slot}-other`}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder={
                slot.provider === "gemini"
                  ? "gemini-…"
                  : slot.provider === "anthropic"
                    ? "claude-…"
                    : "gpt-… or o-series"
              }
            />
          </div>
        )}
      </div>
      <p className="text-p5 text-muted-foreground">
        The listed models are the ones the Replit AI integrations documented as
        available when this list was last checked. Whatever you choose is sent
        one short test request through the {slot.providerLabel} connection and
        is only saved if it answers.
      </p>
      {error && (
        <U.Alert>
          <U.AlertDescription>{error}</U.AlertDescription>
        </U.Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <U.Button
          size="sm"
          disabled={!chosen || chosen === slot.model || busy !== null}
          onClick={() => save(chosen, "save")}
        >
          {busy === "save" ? "Verifying…" : "Verify and save"}
        </U.Button>
        {slot.source === "workspace" && slot.environmentModel && (
          <U.Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => save("", "reset")}
          >
            {busy === "reset"
              ? "Saving…"
              : `Use environment default (${slot.environmentModel})`}
          </U.Button>
        )}
        <U.Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={onCancel}
        >
          Cancel
        </U.Button>
      </div>
    </div>
  );
}

export function ResearchSettings({
  session,
  members,
}: {
  session: Pick<Member, "role"> | null;
  members: Member[];
}) {
  const [view, setView] = useState<ResearchSettingsView | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ModelSlot | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [promptError, setPromptError] = useState("");
  const [showFixed, setShowFixed] = useState(false);
  const isAdmin = session?.role === "admin";
  const load = () =>
    api<ResearchSettingsView>("/research-settings")
      .then((v) => {
        setView(v);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  // Another administrator may change the settings while this page is open:
  // pick up their changes whenever nothing is being edited here.
  const idle = editing === null && draft === null;
  useEffect(() => {
    if (!idle) return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [idle]);
  const apply = (v: ResearchSettingsView) => {
    setView(v);
    setEditing(null);
    setDraft(null);
  };
  const who = (id?: string) =>
    (id && members.find((m) => m.userId === id)?.name) || id || "";
  const savePrompt = async (body: Record<string, unknown>) => {
    if (!view) return;
    setSaving(true);
    setPromptError("");
    try {
      const v = await api<ResearchSettingsView>("/research-settings/prompt", {
        method: "PUT",
        body: JSON.stringify({ ...body, version: view.prompt.version }),
      });
      apply(v);
      U.toast({
        title: body.reset
          ? "Research prompt reset to the default"
          : `Research prompt saved as version ${v.prompt.version}`,
        description:
          "New research runs use it from now on; finished runs keep the version they used.",
      });
    } catch (e) {
      setPromptError((e as Error).message);
      // A stale-version refusal: fetch the current prompt so the badge and
      // the "last changed" line show what is now saved; the draft is kept so
      // nothing typed here is lost while it is compared.
      if (/changed since you opened it/.test((e as Error).message)) void load();
    } finally {
      setSaving(false);
    }
  };
  if (error)
    return (
      <U.Alert>
        <U.AlertTitle>Research settings unavailable</U.AlertTitle>
        <U.AlertDescription>{error}</U.AlertDescription>
      </U.Alert>
    );
  if (!view)
    return (
      <div className="space-y-3">
        <U.Skeleton className="h-6 w-1/3" />
        <U.Skeleton className="h-24 w-full" />
      </div>
    );
  const text = draft ?? view.prompt.instructions;
  const dirty = draft !== null && draft.trim() !== view.prompt.instructions;
  const tiers = (["economy", "power", "max"] as const).map((tier) => ({
    tier,
    slots: view.slots.filter((s) => s.tier === tier),
  }));
  return (
    <>
      <U.Card>
        <U.CardHeader>
          <U.CardTitle>Research connections</U.CardTitle>
          <U.CardDescription>
            Provider keys stay on the server. Each connection's model can be
            changed here by an administrator; the change is verified with the
            provider before it is saved and recorded in the audit log.
          </U.CardDescription>
        </U.CardHeader>
        <U.CardContent className="space-y-6">
          {tiers.map(({ tier, slots }) => (
            <div key={tier} className="space-y-3">
              <div className="flex justify-between gap-3 items-center">
                <p className="text-p3 font-medium">{TIER_NAME[tier]}</p>
                <U.Badge variant="outline">
                  {view.tiers[tier] ? "Ready" : "Needs setup"}
                </U.Badge>
              </div>
              {slots.map((s) => (
                <div key={s.slot} className="space-y-2">
                  <div className="flex flex-wrap justify-between gap-3 items-start">
                    <div className="min-w-0">
                      <p className="text-p5 text-muted-foreground">
                        {slots.length > 1 ? `${s.label} · ` : ""}
                        {s.description}
                      </p>
                      <p className="text-p4 break-words">
                        {s.model ? (
                          <>
                            <span className="font-medium">{s.model}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {s.providerLabel} ·{" "}
                              {s.source === "workspace"
                                ? "set in this workspace"
                                : `environment default (${s.envVar})`}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            No model configured ({s.envVar} is not set)
                          </span>
                        )}
                        {!s.access && (
                          <span className="text-muted-foreground">
                            {" "}
                            · no {s.providerLabel} connection on the server
                          </span>
                        )}
                      </p>
                      {s.problem && (
                        <p className="text-p5 text-destructive mt-1">
                          {s.problem}
                        </p>
                      )}
                    </div>
                    {isAdmin && editing !== s.slot && (
                      <U.Button
                        variant="outline"
                        size="sm"
                        disabled={!s.access}
                        onClick={() => setEditing(s.slot)}
                      >
                        Change model
                      </U.Button>
                    )}
                  </div>
                  {editing === s.slot && (
                    <ModelEditor
                      slot={s}
                      onSaved={apply}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
          {!isAdmin && (
            <p className="text-p5 text-muted-foreground">
              Administrators can change which model each connection uses.
            </p>
          )}
        </U.CardContent>
      </U.Card>
      <U.Card className="lg:col-span-2">
        <U.CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
            <div className="min-w-0 flex-1">
              <U.CardTitle>Research prompt</U.CardTitle>
              <U.CardDescription>
                The instructions every research run sends to the model, before
                the evidence. Review them here; administrators can change them.
              </U.CardDescription>
            </div>
            <U.Badge variant="outline" className="shrink-0 self-start">
              {view.prompt.isDefault
                ? view.prompt.version
                  ? `Default · version ${view.prompt.version}`
                  : "Built-in default"
                : `Version ${view.prompt.version}`}
            </U.Badge>
          </div>
        </U.CardHeader>
        <U.CardContent className="space-y-4">
          <U.Textarea
            aria-label="Research instructions"
            value={text}
            readOnly={!isAdmin}
            rows={14}
            className="font-mono text-p5"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex flex-wrap justify-between gap-3 items-center">
            <p className="text-p5 text-muted-foreground">
              {view.prompt.updatedAt
                ? `Last changed by ${who(view.prompt.updatedBy)} on ${fmt(view.prompt.updatedAt)}. `
                : "Never changed. "}
              Each research run records the prompt version it used.
            </p>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                {!view.prompt.isDefault && (
                  <U.Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => savePrompt({ reset: true })}
                  >
                    Reset to default
                  </U.Button>
                )}
                {dirty && (
                  <U.Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => setDraft(null)}
                  >
                    Discard changes
                  </U.Button>
                )}
                <U.Button
                  size="sm"
                  disabled={!dirty || saving || !text.trim()}
                  onClick={() => savePrompt({ instructions: text })}
                >
                  {saving ? "Saving…" : "Save changes"}
                </U.Button>
              </div>
            )}
          </div>
          {promptError && (
            <U.Alert>
              <U.AlertDescription>{promptError}</U.AlertDescription>
            </U.Alert>
          )}
          <div className="rounded-lg border p-4 space-y-2">
            <button
              type="button"
              className="text-p4 font-medium underline underline-offset-4"
              onClick={() => setShowFixed((v) => !v)}
              aria-expanded={showFixed}
            >
              {showFixed ? "Hide" : "Show"} what the server adds to every run
            </button>
            {showFixed && (
              <div className="space-y-3">
                <div>
                  <p className="text-p5 text-muted-foreground">
                    Output contract (fixed, so responses stay parseable)
                  </p>
                  <p className="text-p5 font-mono break-all mt-1">
                    {view.contract}
                  </p>
                </div>
                <div>
                  <p className="text-p5 text-muted-foreground">
                    Evidence context (fixed)
                  </p>
                  <p className="text-p5 mt-1">{view.contextNote}</p>
                </div>
                <div>
                  <p className="text-p5 text-muted-foreground">
                    Built-in default instructions
                  </p>
                  <p className="text-p5 font-mono whitespace-pre-wrap mt-1">
                    {view.defaultInstructions}
                  </p>
                </div>
              </div>
            )}
          </div>
        </U.CardContent>
      </U.Card>
    </>
  );
}
