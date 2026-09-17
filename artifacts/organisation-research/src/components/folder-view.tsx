import { tierNames, type Finding, type SectionSummary, type Slot, type Source } from "../../shared/types";
import * as U from "../ui";

const sourceKind: Record<Source["kind"], string> = {
  web: "Website", document: "Document", statement: "Statement", image: "Workplace image",
  occupation: "Occupational reference", film: "Film", advert: "Job advert", screenshot: "Screenshot",
  standard: "Apprenticeship standard", guidance: "Professional guidance", note: "Research note",
};
const shownDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function FolderView({ summary, sources, findings, onBack, onSource, onFill, onFact }: {
  summary: SectionSummary;
  sources: Source[];
  findings: Finding[];
  onBack: () => void;
  onSource: (source: Source) => void;
  onFill: (slot: Slot) => void;
  onFact: (finding: Finding) => void;
}) {
  return (
    <div className="space-y-6">
      <U.Button variant="ghost" onClick={onBack}><U.IconArrowLeft size={18} />Back to all folders</U.Button>
      <div><h2 className="text-h4">{summary.title}</h2><p className="text-p4 text-muted-foreground mt-1">{sources.length} item{sources.length === 1 ? "" : "s"} in this folder</p></div>
      <section className="space-y-3">
        <h3 className="text-h6">Folder contents</h3>
        <U.DataTable data={sources} getRowId={(source) => source.id} showColumnVisibility={false} columns={[
          { id: "title", header: "Title", accessor: (source) => source.title, cell: (source) => <U.Button variant="link" className="h-auto p-0 text-left whitespace-normal" onClick={() => onSource(source)}>{source.title}</U.Button> },
          { id: "kind", header: "Type", accessor: (source) => sourceKind[source.kind] },
          { id: "from", header: "Extracted from", accessor: (source) => source.kind === "note" ? source.extractedFrom || "Not recorded" : "—" },
          { id: "tier", header: "Tier", accessor: (source) => source.tier ? `Tier ${source.tier} · ${tierNames[source.tier]}` : "Not set" },
          { id: "export", header: "Export file name", accessor: (source) => source.exportName || "Not available" },
          { id: "date", header: "Added", accessor: (source) => shownDate(source.retrievedAt) },
        ]} empty={<p className="p-6 text-p4 text-muted-foreground">No material has been added to this folder.</p>} />
      </section>
      <section className="space-y-3">
        <h3 className="text-h6">Places</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {summary.slots.map((slot) => (
            <button key={slot.slot} type="button" disabled={slot.filled} onClick={() => onFill(slot.slot)} className="rounded-xl border p-3 text-left disabled:cursor-default">
              <span className="text-p4 font-medium">{slot.label}</span>
              <span className="block text-p5 text-muted-foreground">{slot.filled ? "Filled" : "Empty — record fact"}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-h6">Facts</h3>
        {findings.map((finding) => <U.Card key={finding.id}><U.CardContent className="flex items-start justify-between gap-3 p-4"><p className="text-p4">{finding.claim}</p><U.Button size="sm" variant="outline" onClick={() => onFact(finding)}>Inspect &amp; review</U.Button></U.CardContent></U.Card>)}
        {!findings.length && <p className="text-p4 text-muted-foreground">No facts have been extracted or recorded for this section.</p>}
      </section>
    </div>
  );
}