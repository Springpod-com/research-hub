import { useState, type FormEvent } from "react";
import type { Folder } from "../../shared/types";
import * as U from "../ui";
import { useFormCloseGuard } from "./form-close-guard";

export function NoteForm({ folder, roleScoped, roleId: initialRoleId, roleOptions, onClose, onSubmit }: {
  folder: Folder;
  roleScoped: boolean;
  roleId?: string;
  roleOptions: [string, string][];
  onClose: () => void;
  onSubmit: (value: { title: string; extractedFrom: string; text: string; fromOrganisation: boolean; folder: Folder; roleId?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [extractedFrom, setExtractedFrom] = useState("");
  const [text, setText] = useState("");
  const [fromOrganisation, setFromOrganisation] = useState(false);
  const [roleId, setRoleId] = useState(initialRoleId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeGuard = useFormCloseGuard({ dirty: !!(title || extractedFrom || text), busy, onClose });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (roleScoped && !roleId) throw new Error("Choose a role for this folder.");
      await onSubmit({ title, extractedFrom, text, fromOrganisation, folder, roleId: roleId || undefined });
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <U.Dialog open onOpenChange={closeGuard.onOpenChange}>
      <U.DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <U.DialogHeader>
            <U.DialogTitle>Write a research note</U.DialogTitle>
            <U.DialogDescription>Save a Markdown extract in this folder, together with where it came from.</U.DialogDescription>
          </U.DialogHeader>
          <div className="space-y-2"><U.Label htmlFor="note-title">Title</U.Label><U.Input id="note-title" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-2"><U.Label htmlFor="note-from">Extracted from</U.Label><U.Input id="note-from" required placeholder="URL or description" value={extractedFrom} onChange={(e) => setExtractedFrom(e.target.value)} /></div>
          <div className="space-y-2"><U.Label htmlFor="note-text">Markdown text</U.Label><U.Textarea id="note-text" required rows={10} value={text} onChange={(e) => setText(e.target.value)} /></div>
          {roleScoped && (
            <div className="space-y-2">
              <U.Label>Role</U.Label>
              <U.Select value={roleId} onValueChange={setRoleId}>
                <U.SelectTrigger><U.SelectValue placeholder="Choose a role" /></U.SelectTrigger>
                <U.SelectContent>{roleOptions.map(([value, label]) => <U.SelectItem key={value} value={value}>{label}</U.SelectItem>)}</U.SelectContent>
              </U.Select>
              <p className="text-p5 text-muted-foreground">This folder belongs to a role, so choose where to file the note.</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <U.Checkbox id="note-from-organisation" checked={fromOrganisation} onCheckedChange={(checked) => setFromOrganisation(checked === true)} />
            <U.Label htmlFor="note-from-organisation">This came from the organisation</U.Label>
          </div>
          {error && <U.Alert variant="destructive"><U.AlertDescription>{error}</U.AlertDescription></U.Alert>}
          <U.DialogFooter><U.Button type="button" variant="outline" disabled={busy} onClick={closeGuard.requestClose}>Cancel</U.Button><U.Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save note"}</U.Button></U.DialogFooter>
        </form>
      </U.DialogContent>
      {closeGuard.confirmation}
    </U.Dialog>
  );
}