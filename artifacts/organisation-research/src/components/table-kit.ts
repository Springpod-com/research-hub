/**
 * Shared table style kit — the single source of truth for data-table sizing
 * and spacing across the app. Every data table (and grid/flex pseudo-table)
 * composes these tokens instead of keeping private style constants.
 *
 * The standard pattern:
 *  - Card wrapper: bg-card, 1px border, 16px radius, overflow hidden, shadow.
 *  - Header cells: 11px semibold uppercase muted text, 46px tall, transparent.
 *  - Body cells: py-3.5 vertical padding; px-5 on edge (first/last) columns,
 *    px-0 on interior columns (columns space themselves via widths/min-widths).
 *  - Grid/flex pseudo-tables (kept where a real <table> would break their
 *    responsive layout) reuse the same tokens via the GRID_* classes.
 */

export const TABLE_CARD_CLASS =
  "bg-card border border-border rounded-2xl overflow-hidden shadow-sm";

/** Header <TableRow> — no hover tint, no zebra background. */
export const TABLE_HEAD_ROW_CLASS =
  "border-border hover:bg-transparent bg-transparent";

const HEAD_BASE =
  // springpod-audit-allow — 11px uppercase header type is the app-wide table standard
  "text-[11px] font-semibold text-brand-grey-800 uppercase whitespace-nowrap h-[46px] bg-transparent";

/** Interior header cell. */
export const TABLE_HEAD_CLASS = `${HEAD_BASE} px-0`;
/** First/last column header cell. */
export const TABLE_HEAD_EDGE_CLASS = `${HEAD_BASE} px-5`;

/** Interior body cell. */
export const TABLE_CELL_CLASS = "px-0 py-3.5";
/** First/last column body cell. */
export const TABLE_CELL_EDGE_CLASS = "px-5 py-3.5";

/** Grid pseudo-table header row (caller supplies its grid-cols template). */
export const GRID_HEAD_CLASS =
  // springpod-audit-allow — same 11px header standard for grid pseudo-tables
  "h-[46px] items-center px-5 border-b border-border text-[11px] font-semibold text-brand-grey-800 uppercase";
/** Grid/flex pseudo-table body row padding. */
export const GRID_ROW_CLASS = "px-5 py-3.5";
