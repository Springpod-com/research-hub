import { sectionStageNames, type Section, type SectionSummary } from "../../shared/types";
import * as U from "../ui";

/** Folder status colours: amber while gathering, green once extracted, navy when reviewed. */
const sectionStageVariants: Record<SectionSummary["status"]["stage"], "warning" | "info" | "success" | "default"> = {
  gathering: "warning",
  complete: "info",
  extracted: "success",
  reviewed: "default",
};

export function SectionsView({
  sections,
  selected,
  loading,
  canReview,
  busy,
  onSelect,
  onAdd,
  onStatus,
  onExtract,
}: {
  sections: SectionSummary[];
  selected?: Section;
  loading: boolean;
  canReview: boolean;
  busy: boolean;
  onSelect: (section: Section) => void;
  onAdd: (section: Section, kind: "web" | "upload" | "note" | "statement") => void;
  onStatus: (section: Section, stage: "gathering" | "reviewed") => void;
  onExtract: (section: Section, sourceIds: string[]) => void;
}) {
  if (loading)
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <U.Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sections.map((section) => {
        const canExtract = (section.readableSourceIds || section.sourceIds).length > 0;
        return (
          <U.Card
            key={section.section}
            className={U.cn("cursor-pointer transition-colors hover:border-brand-teal-800", selected === section.section && "border-brand-teal-800")}
            onClick={() => onSelect(section.section)}
          >
            <U.CardHeader>
              <div className="flex items-start justify-between gap-3">
                <U.CardTitle className="text-h6">{section.title}</U.CardTitle>
                <div className="flex flex-wrap justify-end gap-2">
                  {section.note && <U.Badge variant="outline">Note</U.Badge>}
                  <U.Badge variant={sectionStageVariants[section.status.stage]}>{sectionStageNames[section.status.stage]}</U.Badge>
                </div>
              </div>
              <U.CardDescription>
                {section.filled}/{section.total} places filled · {section.sourceIds.length} item{section.sourceIds.length === 1 ? "" : "s"}
                {section.addedSinceExtraction > 0 && (
                  <span className="block text-foreground">{section.addedSinceExtraction} added since extraction</span>
                )}
              </U.CardDescription>
              {!!section.sourceTitles?.length && (
                <p className="text-p5 text-muted-foreground">
                  {section.sourceTitles.slice(0, 3).join(" · ")}
                  {section.sourceTitles.length > 3 ? ` and ${section.sourceTitles.length - 3} more` : ""}
                </p>
              )}
            </U.CardHeader>
            <U.CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                <U.Popover>
                  <U.PopoverTrigger asChild>
                    <U.Button size="sm" variant="outline"><U.IconAdd size={16} />Add material</U.Button>
                  </U.PopoverTrigger>
                  <U.PopoverContent className="w-56 space-y-1">
                    {([
                      ["web", "Capture a page"],
                      ["upload", "Upload files"],
                      ["note", "Write a note"],
                      ["statement", "Record a statement"],
                    ] as const).map(([kind, label]) => (
                      <U.Button key={kind} variant="ghost" size="sm" className="w-full justify-start" onClick={() => onAdd(section.section, kind)}>{label}</U.Button>
                    ))}
                  </U.PopoverContent>
                </U.Popover>
                <U.Button size="sm" disabled={!canExtract || busy} onClick={() => onExtract(section.section, section.sourceIds)}>
                  <U.IconMagicWand size={16} />Extract facts and evidence
                </U.Button>
              </div>
              {!canExtract && <p className="text-p5 text-muted-foreground">Add at least one readable source first</p>}
              {canReview && (
                <div onClick={(event) => event.stopPropagation()}>
                  <U.Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(section.section, section.status.stage === "reviewed" ? "gathering" : "reviewed")}>
                    {section.status.stage === "reviewed" ? "Undo reviewed" : "Reviewed"}
                  </U.Button>
                </div>
              )}
            </U.CardContent>
          </U.Card>
        );
      })}
    </div>
  );
}