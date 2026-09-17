import { useState, type FormEvent } from "react";
import type { Part, Slot, Source } from "../../shared/types";
import * as U from "../ui";
import { AutoTextarea } from "./auto-textarea";
import { FactPlacement } from "./fact-placement";
import {
  FactFields,
  factFieldsClaim,
  normaliseFactFields,
  type FactFieldValues,
} from "./fact-fields";

export function RecordFactDialog({
  initialSlot = "none",
  sources,
  roleId,
  roleOptions,
  onClose,
  onSubmit,
}: {
  initialSlot?: Slot;
  sources: Source[];
  roleId: string;
  roleOptions: [string, string][];
  onClose: () => void;
  onSubmit: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [slot, setSlot] = useState<Slot>(initialSlot);
  const [parts, setParts] = useState<Part[]>([]);
  const [fields, setFields] = useState<FactFieldValues>({});
  const [claim, setClaim] = useState("");
  const [kind, setKind] = useState("company");
  const [sourceId, setSourceId] = useState(sources.find((s) => s.text.trim())?.id || "none");
  const [quote, setQuote] = useState("");
  const [locator, setLocator] = useState("Source excerpt");
  const [rationale, setRationale] = useState("");
  const [scope, setScope] = useState(roleId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const structured = slot !== "none" &&
    ["role.duty","role.advert","role.vocabulary","case.measurement","case.fault","brand.colour","brand.type","media.item","supplied.document","supplied.interview"].includes(slot);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const chosen = sources.find((source) => source.id === sourceId);
      const invented = slot === "case.measurement" && fields.origin === "invented and declared";
      if (kind !== "proposal" && !invented && (!chosen || !quote.trim()))
        throw new Error("Choose a supporting source and paste its exact passage.");
      await onSubmit({
        ...(structured ? { fields: normaliseFactFields(fields) } : { claim }),
        kind,
        rationale,
        slot,
        parts,
        roleId: scope === "all" ? undefined : scope,
        citations: chosen && quote.trim() && !invented
          ? [{ sourceId: chosen.id, quote, locator }]
          : [],
      });
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <U.Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <U.DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <U.DialogHeader>
          <U.DialogTitle>Record a fact</U.DialogTitle>
          <U.DialogDescription>Capture one fact and place it in the knowledge base.</U.DialogDescription>
        </U.DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <FactPlacement slot={slot} parts={parts} onSlotChange={(next) => { setSlot(next); setFields({}); }} onPartsChange={setParts} />
          {structured ? (
            <FactFields slot={slot} values={fields} sources={sources} onChange={setFields} />
          ) : (
            <div className="space-y-2">
              <U.Label htmlFor="record-claim">Fact *</U.Label>
              <AutoTextarea id="record-claim" required value={claim} onChange={(e) => setClaim(e.target.value)} />
            </div>
          )}
          <SelectField label="Classification" value={kind} onChange={setKind} options={[
            ["company", "Organisation fact"], ["occupation", "Occupational context"], ["proposal", "Design proposal"],
          ]} />
          <SelectField label="Supporting source" value={sourceId} onChange={setSourceId} options={[
            ["none", "No source"], ...sources.map((source) => [source.id, source.title] as [string, string]),
          ]} />
          <div className="space-y-2"><U.Label htmlFor="record-quote">Exact supporting passage</U.Label><AutoTextarea id="record-quote" value={quote} onChange={(e) => setQuote(e.target.value)} /></div>
          <div className="space-y-2"><U.Label htmlFor="record-locator">Page or section</U.Label><U.Input id="record-locator" value={locator} onChange={(e) => setLocator(e.target.value)} /></div>
          <div className="space-y-2"><U.Label htmlFor="record-rationale">Scope or uncertainty</U.Label><AutoTextarea id="record-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} /></div>
          <SelectField label="Role scope" value={scope} onChange={setScope} options={roleOptions} />
          {error && <U.Alert variant="destructive"><U.AlertDescription>{error}</U.AlertDescription></U.Alert>}
          <U.DialogFooter><U.Button type="submit" disabled={busy || (!structured && !claim.trim())}>{busy ? "Saving…" : "Record fact"}</U.Button></U.DialogFooter>
        </form>
      </U.DialogContent>
    </U.Dialog>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <div className="space-y-2"><U.Label>{label}</U.Label><U.Select value={value} onValueChange={onChange}><U.SelectTrigger><U.SelectValue /></U.SelectTrigger><U.SelectContent>{options.map(([id, text]) => <U.SelectItem key={id} value={id}>{text}</U.SelectItem>)}</U.SelectContent></U.Select></div>;
}