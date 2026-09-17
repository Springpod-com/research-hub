import {
  partNames,
  sections,
  slots,
  type Part,
  type Slot,
} from "../../shared/types";
import * as U from "../ui";

const PARTS = Object.entries(partNames) as [Part, string][];

export function FactPlacement({
  slot,
  parts,
  onSlotChange,
  onPartsChange,
  allowNone = true,
}: {
  slot: Slot;
  parts: Part[];
  onSlotChange: (slot: Slot) => void;
  onPartsChange: (parts: Part[]) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <U.Label htmlFor="fact-slot">Place in the knowledge base</U.Label>
        <U.Select
          value={slot}
          onValueChange={(value) => onSlotChange(value as Slot)}
        >
          <U.SelectTrigger id="fact-slot">
            <U.SelectValue />
          </U.SelectTrigger>
          <U.SelectContent>
            {allowNone && (
              <U.SelectItem value="none">Fact register only</U.SelectItem>
            )}
            {sections.flatMap((section) => [
              <U.SelectItem
                key={`${section.section}-heading`}
                value={`heading-${section.section}`}
                disabled
              >
                {section.title}
              </U.SelectItem>,
              ...slots
                .filter((item) => item.section === section.section)
                .map((item) => (
                  <U.SelectItem key={item.slot} value={item.slot}>
                    {item.label}
                  </U.SelectItem>
                )),
            ])}
          </U.SelectContent>
        </U.Select>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-p4 font-medium">Chapter parts</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PARTS.map(([part, label]) => (
            <label key={part} className="flex items-center gap-2 text-p4">
              <U.Checkbox
                checked={parts.includes(part)}
                onCheckedChange={(checked) =>
                  onPartsChange(
                    checked
                      ? [...parts, part]
                      : parts.filter((value) => value !== part),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}