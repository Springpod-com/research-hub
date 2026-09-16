import * as U from "../ui";

export function WhatsThis({
  term,
  children,
}: {
  term: string;
  children: string;
}) {
  return (
    <U.Popover>
      <U.PopoverTrigger asChild>
        <U.Button
          type="button"
          variant="ghost"
          size="icon"
          className="inline-flex size-6 align-middle"
          aria-label={`What is ${term}?`}
        >
          <U.IconHelp size={16} />
        </U.Button>
      </U.PopoverTrigger>
      <U.PopoverContent className="max-w-xs text-p4">
        {children}
      </U.PopoverContent>
    </U.Popover>
  );
}
