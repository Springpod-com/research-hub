import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { Pack, PackV2, Slot, Source } from "../shared/types.js";
import { partNames, slotFields } from "../shared/types.js";
import { packMarkdown } from "./domain.js";
import type { Store } from "./store.js";

const templatePath = path.join(
  process.cwd(),
  "docs/templates/Springpod_LEARN_Organisation_Knowledge_Base_V1.docx",
);
const foldersPath = path.join(process.cwd(), "docs/templates/folders");
const folderNames = [
  "01-organisation",
  "02-role",
  "03-case-material",
  "04-media",
  "05-brand",
  "06-organisation-supplied",
] as const;
const MAX_SOURCES = 400;
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

/** Remove characters which XML 1.0 cannot represent before entity escaping. */
const xmlText = (value: unknown) =>
  Array.from(String(value ?? ""))
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return (
        point === 0x9 ||
        point === 0xa ||
        point === 0xd ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      );
    })
    .join("");
const escaped = (value: unknown) =>
  xmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const shown = (value: unknown) =>
  Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
const normal = (value: string) => value.replace(/\s+/g, " ").trim();
const nodeText = ($: CheerioAPI, node: any) =>
  normal($(node).find("w\\:t").text());
const sourceNames = (pack: Pack) =>
  new Map(pack.sources.map((source) => [source.id, source.title]));

function setParagraphText(
  $: CheerioAPI,
  paragraph: Cheerio<any>,
  value: unknown,
) {
  paragraph.children().not("w\\:pPr").remove();
  paragraph.append(
    `<w:r><w:t xml:space="preserve">${escaped(value)}</w:t></w:r>`,
  );
}

function setCellText($: CheerioAPI, cell: Cheerio<any>, value: unknown) {
  let paragraph = cell.children("w\\:p").first();
  if (!paragraph.length) {
    cell.append("<w:p/>");
    paragraph = cell.children("w\\:p").first();
  }
  setParagraphText($, paragraph, value);
  cell.children("w\\:p").slice(1).remove();
}

function paragraphStarting(
  $: CheerioAPI,
  body: Cheerio<any>,
  prefix: string,
) {
  return body
    .children("w\\:p")
    .filter((_, node) => nodeText($, node).startsWith(prefix))
    .first();
}

function tableAfter(
  $: CheerioAPI,
  paragraph: Cheerio<any>,
): Cheerio<any> {
  let next = paragraph.next();
  while (next.length && next[0].name !== "w:tbl") next = next.next();
  return next[0]?.name === "w:tbl" ? next : $([]);
}

function styledParagraph(style: "Heading2" | "Heading3", value: string) {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escaped(value)}</w:t></w:r></w:p>`;
}

function genericTable(rows: unknown[][]) {
  const cell = (value: unknown) =>
    `<w:tc><w:tcPr><w:tcW w:type="auto" w:w="0"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${escaped(value)}</w:t></w:r></w:p></w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:color="auto"/><w:right w:val="single" w:sz="4" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:color="auto"/></w:tblBorders></w:tblPr>${rows.map((row) => `<w:tr>${row.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;
}

function fillPrompt(
  $: CheerioAPI,
  body: Cheerio<any>,
  prefix: string,
  values: string[],
  missing: string[],
) {
  const prompt = paragraphStarting($, body, prefix);
  if (!prompt.length) {
    missing.push(prefix);
    if (values.length)
      body.children("w\\:sectPr").before(
        styledParagraph("Heading3", prefix),
        ...values.map((value) => `<w:p><w:r><w:t xml:space="preserve">${escaped(value)}</w:t></w:r></w:p>`),
      );
    return;
  }
  if (!values.length) return; // Keep the template's bracketed gap prompt.
  for (const value of values) {
    const clone = prompt.clone();
    setParagraphText($, clone, `${prefix} — ${value}`);
    prompt.before(clone);
  }
  prompt.remove();
}

function fillTemplateTable(
  $: CheerioAPI,
  body: Cheerio<any>,
  heading: string,
  rows: unknown[][],
  missing: string[],
  columns?: string[],
) {
  const headingNode = paragraphStarting($, body, heading);
  const target = headingNode.length ? tableAfter($, headingNode) : $([]);
  if (!headingNode.length || !target.length) {
    missing.push(heading);
    if (rows.length)
      body.children("w\\:sectPr").before(
        styledParagraph("Heading3", heading),
        genericTable([columns || rows[0].map((_, index) => `Column ${index + 1}`), ...rows]),
      );
    return;
  }
  if (!rows.length) return;
  const templateRows = target.children("w\\:tr");
  const templateRow = templateRows.eq(1);
  if (!templateRow.length) {
    missing.push(`${heading} table row`);
    target.after(genericTable([columns || [], ...rows]));
    return;
  }
  templateRows.slice(1).remove();
  for (const values of rows) {
    const row = templateRow.clone();
    row.children("w\\:tc").each((index, cell) => {
      setCellText($, $(cell), values[index] ?? "");
    });
    target.append(row);
  }
}

const prosePrefixes: Partial<Record<Slot, string>> = {
  "organisation.paragraph": "In one paragraph",
  "organisation.entity": "The entity",
  "organisation.sites": "Sites",
  "organisation.products": "Products and services",
  "organisation.size": "Size and numbers",
  "organisation.voice": "How it talks about itself",
  "organisation.news": "Recent news",
  "role.title": "The title",
  "role.standard": "The apprenticeship standard",
  "role.ncs": "National Careers Service profile",
  "role.body": "The professional body",
  "role.day": "A day in the role",
  "case.routine": "The routine",
  "case.equipment": "Equipment and instruments",
  "case.safety": "Safety rules that shape a stop",
  "case.people": "The people in the room",
  "brand.guidelines": "Brand guidelines",
  "brand.logo": "Logo",
  "brand.photography": "Photography",
  "brand.house-style": "House style",
  "brand.screenshot": "Screenshots",
  "supplied.may-use": "Names and things we may use",
  "supplied.must-not-say": "Things we must not say",
};
const tableHeadings: Partial<Record<Slot, string>> = {
  "role.duty": "The duties, from the standard",
  "role.advert": "Job adverts and apprenticeship listings",
  "role.vocabulary": "Vocabulary",
  "case.measurement": "What is measured",
  "case.fault": "What typically goes wrong",
  "media.item": "4. Media",
  "brand.colour": "Colours",
  "brand.type": "Type",
  "supplied.document": "Documents received",
  "supplied.interview": "What the interview settled",
};

function fillHeader(
  $: CheerioAPI,
  body: Cheerio<any>,
  values: Record<string, string>,
  missing: string[],
) {
  const title = body.children("w\\:p").first();
  if (title.length) setParagraphText($, title, values.Title);
  else missing.push("Title");
  const header = body.children("w\\:tbl").first();
  if (!header.length) {
    missing.push("Header table");
    return;
  }
  const labels: Record<string, string> = {
    "Organisation, as it writes its own name": values.Organisation,
    "The entity the learner meets": values.Entity,
    "Role, as the organisation names it": values.Role,
    "Compiled by": values["Compiled by"],
    "Started · last updated": values.Dates,
    "Who at the organisation checks facts": values["Fact checker"],
  };
  const seen = new Set<string>();
  header.children("w\\:tr").each((_, row) => {
    const cells = $(row).children("w\\:tc");
    const label = nodeText($, cells[0]);
    if (label in labels) {
      setCellText($, cells.eq(1), labels[label]);
      seen.add(label);
    }
  });
  for (const label of Object.keys(labels))
    if (!seen.has(label)) missing.push(`Header: ${label}`);
}

function v2Rows(pack: PackV2, slot: Slot) {
  const names = sourceNames(pack);
  const registered = pack.sections
    .flatMap((section) => section.slots)
    .find((item) => item.slot === slot)
    ?.findingIds.map((id) => pack.register.find((row) => row.findingId === id))
    .filter(Boolean) as PackV2["register"] | undefined;
  return (registered || []).map((row) => {
    const finding = pack.findings.find((item) => item.id === row.findingId);
    const columns = slotFields[slot] || [];
    return [
      ...columns.map((column, index) => {
        const value = finding?.fields?.[column.key];
        return value === undefined && index === 0 ? row.claim : shown(value);
      }),
      row.tier,
      row.sourceIds.map((id) => names.get(id) || id).join("; "),
      row.date || "—",
    ];
  });
}

function fillV2($: CheerioAPI, body: Cheerio<any>, pack: PackV2) {
  const missing: string[] = [];
  const names = sourceNames(pack);
  fillHeader(
    $,
    body,
    {
      Title: `${pack.organisation.name} · organisation knowledge base`,
      Organisation: pack.header.organisation,
      Entity: pack.header.entity || "—",
      Role: pack.header.role,
      "Compiled by": pack.header.compiledBy,
      Dates: `${pack.header.started.slice(0, 10)} · ${pack.header.lastUpdated.slice(0, 10)}`,
      "Fact checker": pack.header.factChecker || "Not yet named",
    },
    missing,
  );

  for (const [slot, prefix] of Object.entries(prosePrefixes) as [Slot, string][]) {
    const rows = v2Rows(pack, slot).map((_, index) => {
      const ids = pack.sections
        .flatMap((section) => section.slots)
        .find((item) => item.slot === slot)?.findingIds || [];
      const row = pack.register.find((item) => item.findingId === ids[index]);
      return row
        ? `${row.claim} · Tier ${row.tier} · ${row.sourceIds.map((id) => names.get(id) || id).join("; ") || "No source"} · ${row.date || "No date"}`
        : "";
    });
    if (slot === "role.standard" && pack.role.standard) {
      const standard = pack.role.standard;
      rows.unshift(
        `${standard.name}; level ${standard.level}; ${standard.duration}; ${standard.url}; assessment plan ${standard.assessmentPlanUrl}`,
      );
    } else if (slot === "role.ncs" && pack.role.ncsUrl) {
      rows.unshift(pack.role.ncsUrl);
    } else if (slot === "role.body" && pack.role.professionalBody) {
      const professional = pack.role.professionalBody;
      rows.unshift(
        `${professional.name}; registration route: ${professional.registrationRoute}; framework: ${professional.frameworkUrl}`,
      );
    } else if (slot === "brand.guidelines" && pack.organisation.brand?.guidelines) {
      rows.unshift(pack.organisation.brand.guidelines);
    } else if (slot === "brand.logo" && pack.organisation.brand?.logo) {
      rows.unshift(pack.organisation.brand.logo);
    } else if (slot === "brand.photography" && pack.organisation.brand?.photography) {
      rows.unshift(pack.organisation.brand.photography);
    } else if (slot === "brand.house-style" && pack.organisation.brand?.houseStyle) {
      rows.unshift(pack.organisation.brand.houseStyle);
    } else if (slot === "supplied.may-use" && pack.organisation.mayUse?.length) {
      rows.unshift(
        ...pack.organisation.mayUse.map(
          (item) => `${item.text} — ${names.get(item.sourceId) || item.sourceId}`,
        ),
      );
    } else if (slot === "supplied.must-not-say" && pack.organisation.mustNotSay?.length) {
      rows.unshift(
        ...pack.organisation.mustNotSay.map(
          (item) => `${item.text} — ${names.get(item.sourceId) || item.sourceId}`,
        ),
      );
    }
    fillPrompt($, body, prefix, rows.filter(Boolean), missing);
  }

  if (pack.role.interview) {
    const interview = pack.role.interview;
    fillPrompt(
      $,
      body,
      "Who",
      [
        `${interview.who}, ${interview.jobTitle}; ${interview.timeInRole}; may be named: ${interview.mayBeNamed ? "Yes" : "No"}`,
      ],
      missing,
    );
    fillPrompt($, body, "When and how", [`${interview.date}; ${interview.how}`], missing);
    fillPrompt(
      $,
      body,
      "Recording and transcript",
      [
        `Recording: ${interview.recordingSourceId ? names.get(interview.recordingSourceId) || interview.recordingSourceId : "Not recorded"}; transcript: ${interview.transcriptSourceId ? names.get(interview.transcriptSourceId) || interview.transcriptSourceId : "Not recorded"}`,
      ],
      missing,
    );
  }

  for (const [slot, heading] of Object.entries(tableHeadings) as [Slot, string][]) {
    const columns = (slotFields[slot] || []).map((column) => column.label);
    fillTemplateTable($, body, heading, v2Rows(pack, slot), missing, [
      ...columns,
      "Tier",
      "Source",
      "Date",
    ]);
  }
  fillTemplateTable(
    $,
    body,
    "7. Fact register",
    pack.register.map((row) => [
      row.n,
      row.claim,
      row.tier,
      row.sourceIds.map((id) => names.get(id) || id).join("; "),
      row.date || "—",
      row.parts.map((part) => partNames[part]).join("; ") || "—",
      row.verified ? "Yes" : "No",
    ]),
    missing,
    ["#", "Fact", "Tier", "Source", "Date", "Parts", "Verified"],
  );
  fillTemplateTable(
    $,
    body,
    "8. Questions for the organisation",
    pack.questions.map((question) => [
      question.text,
      question.why,
      question.answer || "Unanswered",
      question.updatedAt.slice(0, 10) || "—",
    ]),
    missing,
    ["Question", "Why it matters to the chapter", "Answer", "Date"],
  );
  fillTemplateTable(
    $,
    body,
    "For the organisation to confirm",
    pack.toConfirm.map((row) => [
      row.n,
      row.claim,
      row.tier,
      row.sourceIds.map((id) => names.get(id) || id).join("; "),
      row.parts.map((part) => partNames[part]).join("; "),
      "",
    ]),
    missing,
    ["#", "Fact", "Tier", "Source", "Parts", "Confirmed (initials, date)"],
  );
  body.children("w\\:sectPr").before(
    styledParagraph("Heading2", "Limitations"),
    ...[...pack.limitations, ...missing.map((name) => `Template section not found: ${name}`)].map(
      (value) => `<w:p><w:r><w:t xml:space="preserve">${escaped(`• ${value}`)}</w:t></w:r></w:p>`,
    ),
  );
}

function fillV1(
  $: CheerioAPI,
  body: Cheerio<any>,
  pack: Extract<Pack, { schemaVersion: "1.0.0" }>,
) {
  const missing: string[] = [];
  const names = sourceNames(pack);
  fillHeader(
    $,
    body,
    {
      Title: `${pack.organisation.name} · organisation knowledge base`,
      Organisation: pack.organisation.name,
      Entity: pack.organisation.division || "—",
      Role: pack.role.title,
      "Compiled by": pack.createdBy,
      Dates: pack.createdAt.slice(0, 10),
      "Fact checker": "Not recorded in schema 1.0.0",
    },
    missing,
  );
  fillTemplateTable(
    $,
    body,
    "7. Fact register",
    pack.findings.map((finding, index) => [
      index + 1,
      finding.claim,
      "Schema 1.0.0",
      finding.citations
        .map((citation) => names.get(citation.sourceId) || citation.sourceId)
        .join("; "),
      finding.updatedAt.slice(0, 10),
      "—",
      "—",
    ]),
    missing,
  );
  fillTemplateTable(
    $,
    body,
    "8. Questions for the organisation",
    pack.questions.map((question) => [
      question.text,
      question.why,
      question.answer || "Unanswered",
      question.updatedAt.slice(0, 10),
    ]),
    missing,
  );
  body.children("w\\:sectPr").before(
    styledParagraph("Heading2", "For the organisation to confirm"),
    `<w:p><w:r><w:t>Schema 1.0.0 did not record a confirmation register.</w:t></w:r></w:p>`,
    styledParagraph("Heading2", "Limitations"),
    ...[
      ...pack.limitations,
      "Schema 1.0.0 predates section and slot placement.",
      ...missing.map((name) => `Template section not found: ${name}`),
    ].map(
      (value) => `<w:p><w:r><w:t xml:space="preserve">${escaped(`• ${value}`)}</w:t></w:r></w:p>`,
    ),
  );
}

export async function packDocx(pack: Pack): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(templatePath));
  const document = zip.file("word/document.xml");
  if (!document) throw new Error("The DOCX template has no word/document.xml.");
  const $ = load(await document.async("string"), { xmlMode: true });
  const body = $("w\\:body").first();
  if (!body.length) throw new Error("The DOCX template has no document body.");
  if (pack.schemaVersion === "2.0.0") fillV2($, body, pack);
  else fillV1($, body, pack);
  zip.file("word/document.xml", $.xml());
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";

export function packZipName(pack: Pack) {
  return `${slug(pack.organisation.name)}_${slug(pack.role.title)}_knowledge-base_r${pack.revision}.zip`;
}

const sourceText = (source: Source) =>
  [
    source.title ? `Title: ${source.title}` : "",
    source.url ? `URL: ${source.url}` : "",
    `Retrieved: ${source.retrievedAt.slice(0, 10)}`,
    "",
    source.text,
  ]
    .filter((line, index) => line || index >= 3)
    .join("\n");

function reservePath(used: Set<string>, wanted: string) {
  const extension = path.extname(wanted);
  const initialStem = wanted.slice(0, wanted.length - extension.length);
  const numbered = initialStem.match(/^(.*)-(\d+)$/);
  const stem = numbered?.[1] || initialStem;
  let number = numbered ? Number(numbered[2]) : 1;
  let candidate = wanted;
  while (used.has(candidate.toLocaleLowerCase("en-GB"))) {
    number++;
    candidate = `${stem}-${number}${extension}`;
  }
  used.add(candidate.toLocaleLowerCase("en-GB"));
  return candidate;
}

async function buildFolderZip(pack: Pack, store: Store) {
  const zip = new JSZip();
  const used = new Set<string>();
  const add = (wanted: string, data: string | Buffer) => {
    const name = reservePath(used, wanted);
    zip.file(name, data);
    return name;
  };
  add(
    "Springpod_LEARN_Organisation_Knowledge_Base_V1.docx",
    await packDocx(pack),
  );
  add("knowledge-base.md", packMarkdown(pack));
  add("knowledge-base.json", JSON.stringify(pack, null, 2));
  for (const folder of folderNames)
    add(
      `${folder}/About this folder.txt`,
      await readFile(path.join(foldersPath, folder, "About this folder.txt")),
    );

  let sourceBytes = 0;
  let sourceCount = 0;
  const omitted: string[] = [];
  for (const source of pack.sources) {
    if (sourceCount >= MAX_SOURCES) {
      omitted.push(`${source.exportName || source.title}: source count exceeds ${MAX_SOURCES}`);
      continue;
    }
    const folder = source.folder || "01-organisation";
    const wanted = `${folder}/${source.exportName || `${slug(source.title)}.txt`}`;
    if (source.filename) {
      // Store files are fetched serially, so at most one upload is added to
      // the in-memory working set at a time.
      const bytes = await store.cleanFile(source.id);
      if (!bytes) {
        const extension = path.extname(wanted);
        add(
          `${wanted.slice(0, wanted.length - extension.length)}.txt`,
          "This uploaded file is not included because no clean upload-scan verdict is stored for it.\n",
        );
        continue;
      }
      if (sourceBytes + bytes.length > MAX_SOURCE_BYTES) {
        omitted.push(`${source.exportName || source.title}: aggregate source size exceeds 200 MB`);
        continue;
      }
      sourceBytes += bytes.length;
      sourceCount++;
      add(wanted, bytes);
    } else {
      const contents = sourceText(source);
      const bytes = Buffer.byteLength(contents);
      if (sourceBytes + bytes > MAX_SOURCE_BYTES) {
        omitted.push(`${source.exportName || source.title}: aggregate source size exceeds 200 MB`);
        continue;
      }
      sourceBytes += bytes;
      sourceCount++;
      add(wanted, contents);
    }
  }
  if (omitted.length)
    add(
      "Sources omitted.txt",
      `Some sources were omitted from this export:\n\n${omitted.map((item) => `- ${item}`).join("\n")}\n`,
    );
  return zip;
}

/** Used by the HTTP route so JSZip emits archive chunks instead of one Buffer. */
export async function packFolderZipStream(pack: Pack, store: Store) {
  const zip = await buildFolderZip(pack, store);
  return zip.generateNodeStream({
    type: "nodebuffer",
    streamFiles: true,
    compression: "DEFLATE",
  });
}

/** Kept for direct callers and compact regression fixtures. */
export async function packFolderZip(pack: Pack, store: Store): Promise<Buffer> {
  const zip = await buildFolderZip(pack, store);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const mdCell = (value: string) =>
  value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
export function confirmationMarkdown(pack: PackV2): string {
  const names = sourceNames(pack);
  return [
    "# For the organisation to confirm",
    "",
    "| # | Fact | Tier | Source | Parts | Confirmed (initials, date) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...pack.toConfirm.map(
      (row) =>
        `| ${row.n} | ${mdCell(row.claim)} | ${row.tier} | ${mdCell(row.sourceIds.map((id) => names.get(id) || id).join("; "))} | ${mdCell(row.parts.map((part) => partNames[part]).join("; "))} |  |`,
    ),
    "",
  ].join("\n");
}