---
name: Upload safety rules
description: Invariants for file uploads (single files and ZIP archives of images) that review has enforced twice; read before touching the upload route, multer config or scanner helper.
---

- `research_files.scan_clean` is true only after a configured scanner returned exit 0 on those exact bytes. Development without a scanner stores `false` (files then stay out of exports); production without a scanner command fails closed. Every image inside a ZIP is scanned individually, as if uploaded alone.
- Never raise multer's global memory limit to admit a bigger file type; the route uses a filename-aware bounded storage engine (10 MiB, 100 MiB for .zip) that drops buffered chunks and detaches listeners on overflow so a stalled oversized upload cannot pin memory while the request drains. Transport overflow stays 413; bad or over-limit expanded content is 422.
- Archives are preflighted from the central directory (entry count, ignored metadata entries, extension filter, per-entry and total uncompressed size, image count) before any entry is inflated; signatures are checked after inflation.
  **Why:** the first ZIP build stored unscanned bytes as clean and inflated junk entries before checking limits; review flagged both as blocking.
  **How to apply:** any new upload path (folders, other archive types, URL imports) must reuse the scanner helper's explicit verdict and the same preflight-then-inflate order.
