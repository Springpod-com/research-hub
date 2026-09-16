import { useState } from "react";
import * as U from "../ui";

export function DismissibleNote({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: string;
  className?: string;
}) {
  const key = `note:${id}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === "dismissed";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <U.Alert className={className}>
      <U.AlertTitle>{title}</U.AlertTitle>
      <U.AlertDescription className="space-y-3">
        <p>{children}</p>
        <U.Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            try {
              localStorage.setItem(key, "dismissed");
            } catch {}
            setDismissed(true);
          }}
        >
          Got it
        </U.Button>
      </U.AlertDescription>
    </U.Alert>
  );
}
