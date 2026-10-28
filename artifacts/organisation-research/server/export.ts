import JSZip from "jszip";
import type { Pack } from "../shared/types.js";
import { packMarkdown } from "./domain.js";

/**
 * Pack downloads (plan P1.7, 28 Oct 2026): `knowledge-base.json`, the file
 * Studio imports, and `knowledge-base.md` for people to read, zipped together.
 * The Word document, the six-folder archive of source files and the separate
 * "for the organisation to confirm" page were retired; source files stay in
 * the app and the "to confirm" rows travel inside the pack.
 */
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

export async function packZip(pack: Pack): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("knowledge-base.json", JSON.stringify(pack, null, 2));
  zip.file("knowledge-base.md", packMarkdown(pack));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
