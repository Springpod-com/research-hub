import { slotFields, type Rights, type Slot, type Source } from "../../shared/types";
import * as U from "../ui";

export type FactFieldValues = Record<string, string | string[]>;

const sourceField = (key: string) =>
  key.endsWith("SourceId") || key === "fileSourceId";

export const normaliseFactFields = (values: FactFieldValues) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value.trim().length > 0,
    ),
  );

export const factFieldsClaim = (slot: Slot, values: FactFieldValues) =>
  (slotFields[slot] || [])
    .map(({ key }) => values[key])
    .filter((value) => Array.isArray(value) ? value.length : value?.trim())
    .map((value) => Array.isArray(value) ? value.join(", ") : value)
    .join(" · ");

export function FactFields({
  slot,
  values,
  sources,
  onChange,
}: {
  slot: Slot;
  values: FactFieldValues;
  sources: Source[];
  onChange: (values: FactFieldValues) => void;
}) {
  const columns = slotFields[slot];
  if (!columns) return null;
  const set = (key: string, value: string | string[]) =>
    onChange({ ...values, [key]: value });
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-h6">Table row</h3>
        <p className="text-p5 text-muted-foreground">
          Complete the columns below. The fact text is generated from this row.
        </p>
      </div>
      {columns.map((column) => (
        <div className="space-y-2" key={column.key}>
          <U.Label htmlFor={`fact-field-${column.key}`}>
            {column.label}{column.required ? " *" : ""}
          </U.Label>
          {sourceField(column.key) ? (
            <U.Select
              value={(values[column.key] as string) || "none"}
              onValueChange={(value) => set(column.key, value === "none" ? "" : value)}
            >
              <U.SelectTrigger id={`fact-field-${column.key}`}>
                <U.SelectValue />
              </U.SelectTrigger>
              <U.SelectContent>
                <U.SelectItem value="none">Not selected</U.SelectItem>
                {sources.map((source) => (
                  <U.SelectItem key={source.id} value={source.id}>
                    {source.title}
                  </U.SelectItem>
                ))}
              </U.SelectContent>
            </U.Select>
          ) : column.key === "rights" ? (
            <U.Select
              value={(values.rights as Rights) || "none"}
              onValueChange={(value) => set("rights", value === "none" ? "" : value)}
            >
              <U.SelectTrigger id="fact-field-rights"><U.SelectValue /></U.SelectTrigger>
              <U.SelectContent>
                <U.SelectItem value="none">Not selected</U.SelectItem>
                <U.SelectItem value="organisation-supplied">Supplied by the organisation</U.SelectItem>
                <U.SelectItem value="press-kit">Press kit</U.SelectItem>
                <U.SelectItem value="reference-only">Reference only</U.SelectItem>
              </U.SelectContent>
            </U.Select>
          ) : column.key === "origin" ? (
            <U.Select
              value={(values.origin as string) || "none"}
              onValueChange={(value) => set("origin", value === "none" ? "" : value)}
            >
              <U.SelectTrigger id="fact-field-origin"><U.SelectValue /></U.SelectTrigger>
              <U.SelectContent>
                <U.SelectItem value="none">Not selected</U.SelectItem>
                <U.SelectItem value="invented and declared">Invented and declared</U.SelectItem>
                {sources.map((source) => (
                  <U.SelectItem key={source.id} value={source.id}>{source.title}</U.SelectItem>
                ))}
              </U.SelectContent>
            </U.Select>
          ) : column.list ? (
            <U.Textarea
              id={`fact-field-${column.key}`}
              value={((values[column.key] as string[]) || []).join("\n")}
              onChange={(event) =>
                set(column.key, event.target.value.split(/\n|,/).map((v) => v.trim()).filter(Boolean))
              }
              placeholder="One item per line"
            />
          ) : (
            <U.Input
              id={`fact-field-${column.key}`}
              required={column.required}
              value={(values[column.key] as string) || ""}
              onChange={(event) => set(column.key, event.target.value)}
            />
          )}
        </div>
      ))}
      <div className="rounded-xl border border-border p-4">
        <p className="text-label-3">Live fact preview</p>
        <p className="mt-1 text-p4">{factFieldsClaim(slot, values) || "Complete a column to preview the fact."}</p>
        <p className="mt-1 text-p5 text-muted-foreground">The server’s exact wording is used after saving.</p>
      </div>
    </section>
  );
}