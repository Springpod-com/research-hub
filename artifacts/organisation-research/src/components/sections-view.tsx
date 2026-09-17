import type {
  Section,
  SectionSummary,
  Slot,
} from "../../shared/types";
import * as U from "../ui";

export function SectionsView({
  sections,
  selected,
  loading,
  onSelect,
  onFill,
}: {
  sections: SectionSummary[];
  selected?: Section;
  loading: boolean;
  onSelect: (section: Section) => void;
  onFill: (slot: Slot) => void;
}) {
  if (loading)
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <U.Skeleton key={i} className="h-52 rounded-xl" />
        ))}
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sections.map((section) => (
        <U.Card
          key={section.section}
          className={U.cn(
            "cursor-pointer transition-colors hover:border-brand-teal-800",
            selected === section.section && "border-brand-teal-800",
          )}
          onClick={() => onSelect(section.section)}
        >
          <U.CardHeader>
            <div className="flex items-start justify-between gap-3">
              <U.CardTitle className="text-h6">{section.title}</U.CardTitle>
              <U.Badge variant="outline">
                {section.filled}/{section.total}
              </U.Badge>
            </div>
            <U.CardDescription>
              {section.sourceIds.length} source
              {section.sourceIds.length === 1 ? "" : "s"}
            </U.CardDescription>
          </U.CardHeader>
          <U.CardContent>
            {section.gaps.length ? (
              <>
                <p className="text-label-3 mb-2">Places to fill</p>
                <ul className="space-y-1 text-p5 text-muted-foreground">
                  {section.slots.filter((slot) => !slot.filled).map((slot) => (
                    <li key={slot.slot}>
                      <button
                        type="button"
                        className="text-left underline hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          onFill(slot.slot);
                        }}
                      >
                        {slot.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-p4 text-muted-foreground">
                Every place has at least one fact.
              </p>
            )}
          </U.CardContent>
        </U.Card>
      ))}
    </div>
  );
}