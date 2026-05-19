#!/usr/bin/env node
/**
 * Context7 exec-provider for the search-quality benchmark.
 *
 * Exposes the same JSON contract as `src/tools/search-provider.ts` but fetches
 * results from Context7's public `/v2/context` endpoint instead of the local
 * docs-mcp-server store. Promptfoo's exec provider calls this script, parses
 * stdout as JSON, and feeds the result through the same IR + LLM-judged
 * assertion stack.
 *
 * No vite-node, no TypeScript transform — pure Node + the `https` builtin so
 * provider cold-start is ~100ms instead of ~5s.
 *
 * Reads CONTEXT7_API_KEY from env if set; the endpoints currently accept
 * anonymous requests within reasonable limits, but providing a key is the
 * right thing to do for sustained use.
 */

const https = require("node:https");

/**
 * Maps our benchmark library names to Context7 library IDs. Each entry is the
 * `/websites/<host>` (or canonical maintainer) library, chosen by inspecting
 * Context7's /v2/libs/search response and picking the variant whose source
 * URLs most closely match the qrels in tests/search-eval/dataset.yaml.
 */
const LIBRARY_MAP = {
  react: "/websites/react_dev",
  python: "/websites/python_3",
  fastapi: "/websites/fastapi_tiangolo",
  vite: "/websites/vite_dev",
  tailwindcss: "/tailwindlabs/tailwindcss.com",
};

/**
 * Normalise a Context7-returned URL to the canonical form used in our qrels.
 *
 * Per-library transformations:
 *   - tailwindcss: GitHub source path (.../src/docs/<page>.mdx) → live docs
 *     URL (https://tailwindcss.com/docs/<page>). Context7's
 *     /tailwindlabs/tailwindcss.com library attributes chunks to the source
 *     .mdx, not the rendered page.
 *   - All libraries: strip trailing `/` and any `?...` query string. FastAPI
 *     in particular returns `/tutorial/path-params` while our qrels use
 *     `/tutorial/path-params/`.
 */
function normalizeUrl(library, raw) {
  if (!raw || typeof raw !== "string") return raw;
  let url = raw.trim();

  if (library === "tailwindcss") {
    const m = url.match(
      /^https:\/\/github\.com\/tailwindlabs\/tailwindcss\.com\/blob\/[^/]+\/src\/docs\/(.+?)\.mdx$/,
    );
    if (m) url = `https://tailwindcss.com/docs/${m[1]}`;
  }

  url = url.split("?")[0];
  if (url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

/**
 * Apply the same normalisation to qrel-side URLs. Symmetric normalisation is
 * the only way to make string-match IR metrics meaningful when each side
 * uses a slightly different URL convention. (Our local provider's URLs are
 * normalised by the dataset loader, not here — but applying the same trim
 * defensively doesn't hurt.)
 */
// Exported for tests if anyone ever wants them; not used inside this script.
module.exports = { normalizeUrl, LIBRARY_MAP };

function fetchContext7(libraryId, query) {
  const url = `https://context7.com/api/v2/context?libraryId=${encodeURIComponent(
    libraryId,
  )}&query=${encodeURIComponent(query)}&type=json`;
  const headers = {
    Accept: "application/json",
    "User-Agent": "docs-mcp-server-benchmark/1.0",
  };
  if (process.env.CONTEXT7_API_KEY) {
    headers.Authorization = `Bearer ${process.env.CONTEXT7_API_KEY.trim()}`;
  }
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode === undefined || res.statusCode >= 400) {
          reject(
            new Error(`Context7 HTTP ${res.statusCode}: ${body.slice(0, 300)}`),
          );
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`bad JSON from Context7: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    // Conservative 30s — Context7 sometimes takes ~10s on cold lookups.
    req.setTimeout(30000, () => req.destroy(new Error("Context7 request timed out after 30s")));
  });
}

/**
 * Argv parsing mirroring src/tools/search-provider.ts:
 *
 *   ./run-context7-provider.sh <prompt-tokens...> <provider-config-json> <test-context-json>
 *
 * The two trailing JSON blobs are promptfoo bookkeeping and must NOT be
 * folded into the query. We pop every trailing arg that parses as a JSON
 * object, capturing `vars` from whichever blob carries it.
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let context = {};
  while (args.length > 0) {
    const last = args[args.length - 1].trim();
    if (!last.startsWith("{") || !last.endsWith("}")) break;
    try {
      const parsed = JSON.parse(last);
      if (parsed && typeof parsed === "object") {
        if (parsed.vars && !context.vars) context = parsed;
        args.pop();
        continue;
      }
    } catch {}
    break;
  }
  return { query: args.join(" ").trim(), context };
}

function resolveTopK() {
  const raw = process.env.DOCS_EVAL_TOP_K?.trim();
  if (!raw) return 5;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    console.error(
      `Invalid DOCS_EVAL_TOP_K="${raw}": must be integer in [1, 100].`,
    );
    process.exit(1);
  }
  return n;
}

function formatSnippet(s, kind) {
  if (kind === "code") {
    const title = s.codeTitle ? `## ${s.codeTitle}\n\n` : "";
    const desc = s.codeDescription ? `${s.codeDescription}\n\n` : "";
    const blocks = (s.codeList || [])
      .map((c) => `\`\`\`${c.language || ""}\n${c.code}\n\`\`\``)
      .join("\n\n");
    return `${title}${desc}${blocks}`.trim();
  }
  // info snippet
  const bc = s.breadcrumb ? `## ${s.breadcrumb}\n\n` : "";
  return `${bc}${s.content || ""}`.trim();
}

async function main() {
  const { query, context } = parseArgs(process.argv);
  const library = context.vars?.library || process.env.LIBRARY || "react";
  if (!query) {
    console.error("Error: no query provided");
    process.exit(1);
  }
  const libraryId = LIBRARY_MAP[library];
  if (!libraryId) {
    console.error(
      `Error: no Context7 library mapping for library="${library}". Add it to LIBRARY_MAP.`,
    );
    process.exit(1);
  }
  const topK = resolveTopK();

  let response;
  try {
    response = await fetchContext7(libraryId, query);
  } catch (e) {
    console.error("Context7 fetch failed:", e.message);
    process.exit(1);
  }

  /**
   * Combine code + info snippets in their returned order, dedupe by
   * normalised URL (the same source page often shows up as both a code
   * snippet and an info snippet — we count it once for IR purposes),
   * truncate to top-k.
   *
   * Score is synthetic: 1.0 → 0.0 linearly. Context7 doesn't expose its own
   * relevance score in this endpoint; our IR metrics only use rank position
   * (which is preserved) so the absolute score values are immaterial.
   */
  const code = response.codeSnippets || [];
  const info = response.infoSnippets || [];
  const results = [];
  const seen = new Set();

  for (const s of code) {
    const url = normalizeUrl(library, s.codeId);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({ url, content: formatSnippet(s, "code") });
    if (results.length >= topK) break;
  }
  if (results.length < topK) {
    for (const s of info) {
      const url = normalizeUrl(library, s.pageId);
      if (!url || seen.has(url)) continue;
      // Context7 sometimes uses `<lib>/llms.txt` as a placeholder pageId for
      // info snippets that don't have a per-page source. Those carry no useful
      // URL signal — drop them rather than poisoning IR metrics with always-
      // wrong URLs.
      if (url.endsWith("/llms.txt")) continue;
      seen.add(url);
      results.push({ url, content: formatSnippet(s, "info") });
      if (results.length >= topK) break;
    }
  }

  const indexed = results.map((r, i) => ({
    url: r.url,
    score: Math.max(0, 1 - i * 0.01),
    position: i,
    content: r.content,
  }));

  const outputText =
    indexed.length === 0
      ? "No search results found."
      : indexed
          .map(
            (r, i) =>
              `--- Result ${i + 1} (Score: ${r.score.toFixed(3)}) ---\nURL: ${r.url}\n\n${r.content}`,
          )
          .join("\n\n");

  console.log(
    JSON.stringify({
      output: outputText,
      metadata: {
        library,
        query,
        provider: "context7",
        results: indexed,
      },
    }),
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Unhandled provider error:", err);
    process.exit(1);
  });
}
