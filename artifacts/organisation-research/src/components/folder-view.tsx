import { useEffect, useState } from "react";
import { sectionNoteMaxLength, tierNames, type Finding, type SectionSummary, type Slot, type Source } from "../../shared/types";
import * as U from "../ui";

const sourceKind: Record<Source["kind"], string> = {
  web: "Website", document: "Document", statement: "Statement", image: "Workplace image",
  occupation: "Occupational reference", film: "Film", advert: "Job advert", screenshot: "Screenshot",
  standard: "Apprenticeship standard", guidance: "Professional guidance", note: "Research note",
};
const shownDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function FolderView({ summary, sources, findings, canEditNote, noteEditHint, onBack, onSource, onFill, onFact, onSaveNote }: {
  summary: SectionSummary;
  sources: Source[];
  findings: Finding[];
  canEditNote: boolean;
  noteEditHint?: string;
  onBack: () => void;
  onSource: (source: Source) => void;
  onFill: (slot: Slot) => void;
  onFact: (finding: Finding) => void;
  onSaveNote: (text: string) => Promise<void>;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(summary.note?.text || "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");

  useEffect(() => {
    if (!editingNote) setNoteText(summary.note?.text || "");
  }, [summary.note, editingNote]);

  const saveNote = async () => {
    setNoteSaving(true);
    setNoteError("");
    try {
      await onSaveNote(noteText);
      setEditingNote(false);
    } catch (caught) {
      setNoteError((caught as Error).message);
    } finally {
      setNoteSaving(false);
    }
  };

  const cancelNote = () => {
    setNoteText(summary.note?.text || "");
    setNoteError("");
    setEditingNote(false);
  };

  return (
    <div className="space-y-6">
      <U.Button variant="ghost" onClick={onBack}><U.IconArrowLeft size={18} />Back to all folders</U.Button>
      <div><h2 className="text-h4">{summary.title}</h2><p className="text-p4 text-muted-foreground mt-1">{sources.length} item{sources.length === 1 ? "" : "s"} in this folder</p></div>
      <U.Card>
        <U.CardHeader className="flex-row items-center justify-between gap-3">
          <U.CardTitle className="text-h6">Designer's note</U.CardTitle>
          {canEditNote && !editingNote && (
            <U.Button size="sm" variant="outline" onClick={() => setEditingNote(true)}>
              {summary.note ? "Edit" : "Write a note"}
            </U.Button>
          )}
        </U.CardHeader>
        <U.CardContent>
          {editingNote ? (
            <div className="space-y-3">
              <U.Textarea
                aria-label="Designer's note"
                value={noteText}
                maxLength={sectionNoteMaxLength}
                rows={8}
                onChange={(event) => setNoteText(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-p5 text-muted-foreground">
                  {noteText.length.toLocaleString("en-GB")} / {sectionNoteMaxLength.toLocaleString("en-GB")}
                </p>
                <div className="flex gap-2">
                  <U.Button size="sm" variant="outline" disabled={noteSaving} onClick={cancelNote}>Cancel</U.Button>
                  <U.Button size="sm" disabled={noteSaving} onClick={() => void saveNote()}>
                    {noteSaving ? "Saving…" : "Save"}
                  </U.Button>
                </div>
              </div>
              {noteError && (
                <U.Alert role="alert" variant="destructive">
                  <U.AlertTitle>Note could not be saved</U.AlertTitle>
                  <U.AlertDescription>{noteError}</U.AlertDescription>
                </U.Alert>
              )}
            </div>
          ) : summary.note ? (
            <div className="space-y-2">
              <p className="text-p4 whitespace-pre-wrap break-words">{summary.note.text}</p>
              <p className="text-p5 text-muted-foreground">{summary.note.by} · {shownDate(summary.note.at)}</p>
            </div>
          ) : (
            <p className="text-p4 text-muted-foreground">No designer's note yet.</p>
          )}
          {!editingNote && noteEditHint && (
            <p className="mt-2 text-p5 text-muted-foreground">{noteEditHint}</p>
          )}
        </U.CardContent>
      </U.Card>
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