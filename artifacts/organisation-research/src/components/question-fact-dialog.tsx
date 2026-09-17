import { useState } from "react";
import type { Part, Question, Slot } from "../../shared/types";
import { post } from "../api";
import * as U from "../ui";
import { AutoTextarea } from "./auto-textarea";
import { FactPlacement } from "./fact-placement";
import { useFormCloseGuard } from "./form-close-guard";

export function QuestionFactDialog({
  question,
  onClose,
  onSaved,
}: {
  question: Question;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [claim, setClaim] = useState(question.answer);
  const [slot, setSlot] = useState<Slot>("none");
  const [parts, setParts] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeGuard = useFormCloseGuard({
    dirty: claim !== question.answer || slot !== "none" || parts.length > 0,
    busy,
    onClose,
  });

  return (
    <U.Dialog open onOpenChange={closeGuard.onOpenChange}>
      <U.DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <U.DialogHeader>
          <U.DialogTitle>Turn the answer into a fact</U.DialogTitle>
          <U.DialogDescription>
            The answer becomes organisation-supplied source material and a fact
            ready for review.
          </U.DialogDescription>
        </U.DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <U.Label htmlFor="answer-fact-claim">Fact</U.Label>
            <AutoTextarea
              id="answer-fact-claim"
              value={claim}
              onChange={(event) => setClaim(event.target.value)}
            />
          </div>
          <FactPlacement
            slot={slot}
            parts={parts}
            onSlotChange={setSlot}
            onPartsChange={setParts}
            allowNone={false}
          />
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
            disabled={busy || !claim.trim() || slot === "none"}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await post(`/questions/${question.id}/fact`, {
                  slot,
                  parts,
                  claim,
                });
                await onSaved();
                onClose();
              } catch (caught) {
                setError((caught as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create fact"}
          </U.Button>
        </U.DialogFooter>
      </U.DialogContent>
      {closeGuard.confirmation}
    </U.Dialog>
  );
}