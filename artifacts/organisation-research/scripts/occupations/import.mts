/**
 * Builds the bundled occupational reference datasets in data/occupations/.
 *
 *   pnpm --filter @workspace/organisation-research run occupations:import
 *
 * Sources (both permit redistribution with attribution):
 * - ONS Standard Occupational Classification 2020: Volume 1 (unit group
 *   descriptions and tasks) and Volume 2 (the coding index of job titles).
 *   Open Government Licence v3.0. The current workbook URLs are discovered
 *   from the ONS pages, so re-running picks up the latest edition.
 * - O*NET Database (US Department of Labor / National Center for O*NET
 *   Development), text release. CC BY 4.0. Version via ONET_VERSION (31_0).
 *
 * The output keeps a focused selection per occupation (titles, description,
 * tasks, activities, skills, knowledge, work context) with dataset identity,
 * version, licence and retrieval time. Nothing here describes any employer.
 */
import JSZip from "jszip";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type {
  OccupationDataset,
  OccupationEntry,
} from "../../shared/occupations.js";

const OUT_DIR = path.resolve(import.meta.dirname, "../../data/occupations");
const CACHE_DIR = process.env.OCC_CACHE_DIR || "/tmp/occupations-import";
const ONET_VERSION = process.env.ONET_VERSION || "31_0";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) SpringpodOrganisationResearch/1.0 (dataset import)";
const ONS = "https://www.ons.gov.uk";
const ONS_VOL1_PAGE = `${ONS}/methodology/classificationsandstandards/standardoccupationalclassificationsoc/soc2020/soc2020volume1structureanddescriptionsofunitgroups`;
const ONS_VOL2_PAGE = `${ONS}/methodology/classificationsandstandards/standardoccupationalclassificationsoc/soc2020/soc2020volume2codingrulesandconventions`;
const ONET_ZIP = `https://www.onetcenter.org/dl_files/database/db_${ONET_VERSION}_text.zip`;

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

async function download(url: string, name: string): Promise<Buffer> {
  const file = path.join(CACHE_DIR, name);
  if (existsSync(file)) return readFileSync(file);
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}
async function discoverXlsx(page: string): Promise<string> {
  const html = await (
    await fetch(page, { headers: { "user-agent": UA } })
  ).text();
  const m = html.match(/href="(\/file\?uri=[^"]+\.xlsx)"/);
  if (!m) throw new Error(`No .xlsx link found on ${page}`);
  return ONS + m[1].replace(/&amp;/g, "&");
}

// --- minimal .xlsx reader (shared strings + inline strings) -----------------
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
async function workbook(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const ss = (await zip.file("xl/sharedStrings.xml")?.async("string")) || "";
  const strings = [...ss.matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    decode(
      [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join(""),
    ),
  );
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) =>
    decode(m[1]),
  );
  const sheet = async (name: string): Promise<string[][]> => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`Sheet "${name}" not found (have ${names})`);
    const xml = await zip
      .file(`xl/worksheets/sheet${i + 1}.xml`)!
      .async("string");
    return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/gs)].map((row) => {
      const out: string[] = [];
      for (const c of row[1].matchAll(
        /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs,
      )) {
        const col =
          c[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) -
          1;
        const body = c[3] || "";
        const v =
          body.match(/<v>(.*?)<\/v>/s)?.[1] ??
          [...body.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join("");
        out[col] = (c[2].includes('t="s"') ? strings[Number(v)] : decode(v))
          .replace(/\s+/g, " ")
          .trim();
      }
      return out;
    });
  };
  return { names, sheet };
}
const lines = (cell: string | undefined) =>
  (cell || "")
    .split(/\s*~\s*/)
    .map((s) => s.trim().replace(/[.;]$/, ""))
    .filter(Boolean);
const uniq = (list: string[], cap: number) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
};

// --- UK SOC 2020 -------------------------------------------------------------
async function buildSoc(): Promise<OccupationDataset> {
  const vol1Url = await discoverXlsx(ONS_VOL1_PAGE);
  const vol2Url = await discoverXlsx(ONS_VOL2_PAGE);
  const edition = (url: string) => {
    const d = url.match(/(\d{4})(\d{2})(\d{2})\.xlsx$/);
    return d ? `${d[1]}-${d[2]}-${d[3]}` : "unknown edition";
  };
  const vol1 = await workbook(await download(vol1Url, "soc-vol1.xlsx"));
  const vol2 = await workbook(await download(vol2Url, "soc-vol2.xlsx"));
  const descriptions = await vol1.sheet("SOC2020 descriptions");
  const index = await vol2.sheet("SOC2020 coding index");
  const info = await vol2.sheet("INFO");
  const indexVersion =
    info
      .flat()
      .join(" ")
      .match(/Version (\d+)/i)?.[1] || "?";
  // Index rows: SOC_2020 (G), ADD (J), IND (K), SEE (L), natural word order (V)
  const altTitles = new Map<string, [string[], string[]]>();
  const header = index[0];
  const col = (name: string) => header.findIndex((h) => h === name);
  const cCode = col("SOC_2020");
  const cAdd = col("ADD");
  const cInd = col("IND");
  const cSee = col("SEE");
  const cNatural = col("INDEXOCC_-_natural_word_order");
  const cIndexOcc = col("INDEXOCC");
  for (const row of index.slice(1)) {
    const code = row[cCode];
    if (!/^\d{4}$/.test(code || "") || row[cSee]) continue;
    const natural = row[cNatural] || row[cIndexOcc];
    if (!natural) continue;
    const qualifier = [row[cAdd], row[cInd]].filter(Boolean).join("; ");
    const title = qualifier ? `${natural} (${qualifier})` : natural;
    // Unqualified titles first: they are the plain job titles people use.
    const list = altTitles.get(code) || [[], []];
    list[qualifier ? 1 : 0].push(title);
    altTitles.set(code, list);
  }
  const entries: OccupationEntry[] = [];
  for (const row of descriptions) {
    const code = row[4];
    if (!/^\d{4}$/.test(code || "")) continue;
    entries.push({
      code,
      title: row[5] || "",
      description: row[7] || "",
      altTitles: uniq(
        [...lines(row[10]), ...(altTitles.get(code) || [[], []]).flat()],
        80,
      ),
      tasks: lines(row[9]),
      activities: [],
      skills: [],
      knowledge: [],
      workContext: [],
      entryRoutes: row[8] || "",
    });
  }
  return {
    scheme: "UK SOC",
    name: "Standard Occupational Classification 2020 (UK)",
    version: `SOC 2020 (ONS Volume 1 ${edition(vol1Url)}; coding index v${indexVersion} ${edition(vol2Url)})`,
    jurisdiction: "UK",
    publisher: "Office for National Statistics",
    licence:
      "Open Government Licence v3.0 (contains public sector information licensed under the OGL v3.0)",
    sourceUrls: [ONS_VOL1_PAGE, ONS_VOL2_PAGE],
    entryUrl: ONS_VOL1_PAGE,
    retrievedAt: new Date().toISOString(),
    entries,
  };
}

// --- O*NET -------------------------------------------------------------------
async function buildOnet(): Promise<OccupationDataset> {
  const zip = await JSZip.loadAsync(
    await download(ONET_ZIP, `onet-${ONET_VERSION}.zip`),
  );
  const prefix = `db_${ONET_VERSION}_text/`;
  const table = async (name: string) => {
    const text = await zip.file(`${prefix}${name}.txt`)!.async("string");
    const [head, ...rows] = text.split(/\r?\n/).filter(Boolean);
    const cols = head.split("\t");
    return rows.map((r) => {
      const cells = r.split("\t");
      return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
    });
  };
  const readme = await zip.file(`${prefix}Read Me.txt`)!.async("string");
  const release = readme.match(/O\*NET ([\d.]+) Database\s+([A-Za-z]+ \d{4})/);
  const byCode = <T extends Record<string, string>>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r["O*NET-SOC Code"]) || [];
      list.push(r);
      m.set(r["O*NET-SOC Code"], list);
    }
    return m;
  };
  const rated = (
    rows: Record<string, string>[],
    scale: string,
    min: number,
    cap: number,
  ) => {
    const m = new Map<string, string[]>();
    const grouped = byCode(
      rows.filter(
        (r) =>
          r["Scale ID"] === scale &&
          r["Recommend Suppress"] !== "Y" &&
          r["Not Relevant"] !== "Y",
      ),
    );
    for (const [code, list] of grouped) {
      const top = list
        .map((r) => ({
          name: r["Element Name"],
          value: Number(r["Data Value"]),
        }))
        .filter((r) => r.value >= min)
        .sort((a, b) => b.value - a.value)
        .slice(0, cap)
        .map((r) => `${r.name} (${r.value.toFixed(1)}/5)`);
      m.set(code, top);
    }
    return m;
  };
  const occupations = await table("Occupation Data");
  const tasks = byCode(await table("Task Statements"));
  const reported = byCode(await table("Sample of Reported Titles"));
  const lay = byCode(await table("Job Titles"));
  const essential = rated(await table("Essential Skills"), "IM", 3, 6);
  const transferable = rated(await table("Transferable Skills"), "IM", 3, 6);
  const knowledge = rated(await table("Knowledge"), "IM", 3, 8);
  const activities = rated(await table("Work Activities"), "IM", 3, 10);
  const context = rated(await table("Work Context"), "CX", 3.5, 8);
  const entries: OccupationEntry[] = occupations.map((o) => {
    const code = o["O*NET-SOC Code"];
    const t = tasks.get(code) || [];
    const core = t.filter((x) => x["Task Type"] === "Core").map((x) => x.Task);
    const extra = t.filter((x) => x["Task Type"] !== "Core").map((x) => x.Task);
    return {
      code,
      title: o.Title,
      description: o.Description,
      altTitles: uniq(
        [
          ...(reported.get(code) || []).map((r) => r["Reported Job Title"]),
          ...(lay.get(code) || []).map((r) => r["Job Title"]),
        ],
        40,
      ),
      tasks: uniq([...core, ...extra], Math.max(12, Math.min(core.length, 20))),
      activities: activities.get(code) || [],
      skills: uniq(
        [...(essential.get(code) || []), ...(transferable.get(code) || [])],
        12,
      ),
      knowledge: knowledge.get(code) || [],
      workContext: context.get(code) || [],
    };
  });
  return {
    scheme: "O*NET",
    name: "O*NET Database (US occupational information)",
    version: release
      ? `O*NET ${release[1]} Database (${release[2]} release)`
      : `O*NET ${ONET_VERSION.replace("_", ".")} Database`,
    jurisdiction: "US",
    publisher:
      "U.S. Department of Labor, Employment and Training Administration (USDOL/ETA) / National Center for O*NET Development",
    licence:
      "Creative Commons Attribution 4.0 International (CC BY 4.0). O*NET® is a trademark of USDOL/ETA. Springpod is not affiliated with USDOL.",
    sourceUrls: ["https://www.onetcenter.org/database.html", ONET_ZIP],
    entryUrl: "https://www.onetonline.org/link/summary/{code}",
    retrievedAt: new Date().toISOString(),
    entries,
  };
}

const [soc, onet] = await Promise.all([buildSoc(), buildOnet()]);
for (const [file, dataset] of [
  ["uk-soc-2020.json", soc],
  ["onet.json", onet],
] as const) {
  const target = path.join(OUT_DIR, file);
  writeFileSync(target, JSON.stringify(dataset));
  console.log(
    `${file}: ${dataset.entries.length} occupations, ${(readFileSync(target).length / 1024 / 1024).toFixed(1)} MB — ${dataset.version}`,
  );
}
