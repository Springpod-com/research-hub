import { useCallback, useState } from "react";
import * as U from "../ui";

export function useFormCloseGuard({
  dirty,
  busy,
  onClose,
}: {
  dirty: boolean;
  busy?: boolean;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setConfirming(true);
    else onClose();
  }, [busy, dirty, onClose]);

  return {
    requestClose,
    onOpenChange: (open: boolean) => {
      if (!open) requestClose();
    },
    confirmation: (
      <U.AlertDialog open={confirming} onOpenChange={setConfirming}>
        <U.AlertDialogContent>
          <U.AlertDialogHeader>
            <U.AlertDialogTitle>Discard changes?</U.AlertDialogTitle>
            <U.AlertDialogDescription>
              Your unsaved changes will be lost.
            </U.AlertDialogDescription>
          </U.AlertDialogHeader>
          <U.AlertDialogFooter>
            <U.AlertDialogCancel>Keep editing</U.AlertDialogCancel>
            <U.AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onClose}
            >
              Discard
            </U.AlertDialogAction>
          </U.AlertDialogFooter>
        </U.AlertDialogContent>
      </U.AlertDialog>
    ),
  };
}
