import { lookup } from "node:dns/promises";
import { Agent, fetch as safeFetch } from "undici";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { HttpError } from "./domain.js";
export function publicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export async function fetchPublic(
  raw: string,
): Promise<{ url: string; html: string }> {
  let current = new URL(raw);
  for (let redirect = 0; redirect < 4; redirect++) {
    if (
      !["https:", "http:"].includes(current.protocol) ||
      current.username ||
      current.password ||
      (current.port && !["80", "443"].includes(current.port))
    )
      throw new HttpError(
        422,
        "Use a public website address without credentials or a custom port.",
      );
    const host = current.hostname.replace(/^\[|\]$/g, "");
    const answers = await lookup(host, { all: true });
    if (!answers.length || answers.some((a) => !publicAddress(a.address)))
      throw new HttpError(
        422,
        "Private and reserved network addresses cannot be researched.",
      );
    const pinned = answers[0];
    const dispatcher = new Agent({
      connect: {
        lookup: ((_hostname: any, options: any, cb: any) =>
          options.all
            ? cb(null, [pinned])
            : cb(null, pinned.address, pinned.family)) as any,
      },
    });
    try {
      const r = await safeFetch(current, {
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: {
          "user-agent": "OrganisationResearch/1.0 (public source research)",
          accept: "text/html,text/plain",
        },
      });
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const next = r.headers.get("location");
        await r.body?.cancel();
        if (!next) throw new Error("Redirect without a destination");
        current = new URL(next, current);
        continue;
      }
      if (!r.ok) {
        await r.body?.cancel();
        throw new Error(`Website returned HTTP ${r.status}`);
      }
      if (
        !/text\/html|text\/plain|application\/xhtml/.test(
          r.headers.get("content-type") || "",
        )
      ) {
        await r.body?.cancel();
        throw new Error(
          "Use a HTML/text page, or upload the document separately.",
        );
      }
      const reader = r.body!.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 2_000_000) {
          await reader.cancel();
          throw new Error("Page exceeds the 2 MB research limit.");
        }
        chunks.push(chunk.value);
      }
      return {
        url: current.href,
        html: Buffer.concat(chunks).toString("utf8"),
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("Too many website redirects.");
}
export function extractPage(html: string, url: string) {
  const $ = load(html);
  // Only the document title: inline SVG icons carry their own <title>
  // elements ("Company logo"), which would otherwise be concatenated.
  const title =
    ($("head title").first().text() || $("title").first().text())
      .replace(/\s+/g, " ")
      .trim() || new URL(url).hostname;
  const links = $("a[href]")
    .map((_, a) => {
      try {
        return new URL($(a).attr("href")!, url).href;
      } catch {
        return "";
      }
    })
    .get()
    .filter((u) => {
      try {
        return (
          new URL(u).origin === new URL(url).origin &&
          /about|career|work|team|service/i.test(u)
        );
      } catch {
        return false;
      }
    });
  $("script,style,nav,footer,header,noscript,svg,form").remove();
  // Block elements are separated so adjacent paragraphs and headings do not
  // run together once whitespace is collapsed.
  $("p,li,h1,h2,h3,h4,h5,h6,div,section,article,tr,td,th,blockquote,br").after(
    " ",
  );
  const text = $("main").length ? $("main").text() : $("body").text();
  return {
    title,
    text: text.replace(/\s+/g, " ").trim().slice(0, 24000),
    links: [...new Set(links)].slice(0, 3),
  };
}
