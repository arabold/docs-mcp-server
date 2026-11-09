/**
 * Content that a docs page embeds, rendered in a real Chromium.
 *
 * With `scrapeMode: playwright`, the HTML pipeline renders each page and pulls
 * in text that a plain HTML parser never sees: the bodies of iframes, the
 * frames of a frameset, and open shadow roots. These tests serve such pages
 * from a local server and check that every piece of text reaches the Markdown,
 * in the order a reader sees it.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchStatus } from "../src/scraper/fetcher/types";
import { HtmlPipeline } from "../src/scraper/pipelines/HtmlPipeline";
import { ScrapeMode } from "../src/scraper/types";
import { loadConfig } from "../src/utils/config";
import { listenOnFreePort } from "./test-helpers";

const PAGES: Record<string, string> = {
  "/iframes.html": `<html><body>
    <p>Intro paragraph</p>
    <iframe src="/frame-one.html"></iframe>
    <p>Between paragraph</p>
    <iframe src="about:blank"></iframe>
    <iframe src="data:text/html,<p>Data URL frame text</p>"></iframe>
    <iframe src="javascript:'<p>Script URL frame text</p>'"></iframe>
    <iframe src="/frame-three.html"></iframe>
    <p>Outro paragraph</p>
  </body></html>`,
  "/frame-one.html": "<html><body><p>Frame one text</p></body></html>",
  // The loader keeps this iframe busy until the first iframe is inlined, so it
  // always finishes second, as a slower embed on a real page would. Inlining
  // the first iframe shifts the position of every iframe after it.
  "/frame-three.html": `<html><body>
    <div class="loading">Loading…</div>
    <p>Frame three text</p>
    <script>
      const timer = setInterval(() => {
        if (!parent.document.querySelector('iframe[src="/frame-one.html"]')) {
          document.querySelector(".loading").remove();
          clearInterval(timer);
        }
      }, 10);
    </script>
  </body></html>`,
  "/shadow.html": `<html><body>
    <p>Light paragraph</p>
    <doc-card></doc-card>
    <script>
      document.querySelector("doc-card").attachShadow({ mode: "open" }).innerHTML =
        "<p>Shadow paragraph</p>";
    </script>
  </body></html>`,
  "/frameset.html": `<html>
    <frameset cols="20%,80%">
      <frame src="/frame-nav.html" name="navigation">
      <frame src="/frame-main.html" name="content">
    </frameset>
  </html>`,
  "/frame-nav.html": "<html><body><p>Navigation frame text</p></body></html>",
  "/frame-main.html": "<html><body><p>Main frame text</p></body></html>",
  "/scripted-frameset.html": `<html>
    <frameset cols="100%">
      <frame src="/frame-scripted.html">
    </frameset>
  </html>`,
  // The text exists only once the frame's script has run.
  "/frame-scripted.html": `<html><body>
    <p id="out"></p>
    <script>
      document.getElementById("out").textContent = ["Scripted", "frame", "text"].join(" ");
    </script>
  </body></html>`,
};

describe("Embedded content in a real browser", () => {
  let server: Server;
  let baseUrl: string;
  let pipeline: HtmlPipeline;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const body = PAGES[req.url ?? "/"];
      if (body === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
    });
    baseUrl = `http://127.0.0.1:${await listenOnFreePort(server)}`;

    const config = loadConfig();
    // The test server listens on loopback.
    config.scraper.security.network.allowPrivateNetworks = true;
    pipeline = new HtmlPipeline(config);
  });

  afterAll(async () => {
    await pipeline?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Renders a served page through the HTML pipeline and returns its Markdown. */
  async function render(path: string): Promise<string> {
    const source = `${baseUrl}${path}`;
    const result = await pipeline.process(
      {
        content: PAGES[path] ?? "",
        mimeType: "text/html",
        source,
        status: FetchStatus.SUCCESS,
      },
      {
        url: source,
        library: "test-lib",
        version: "1.0.0",
        scrapeMode: ScrapeMode.Playwright,
      },
    );
    expect(result.errors).toEqual([]);
    return typeof result.textContent === "string" ? result.textContent : "";
  }

  /** The position of each text in the content; -1 for any that is missing. */
  function positions(content: string, texts: string[]): number[] {
    return texts.map((text) => content.indexOf(text));
  }

  it("inlines each loadable iframe at its own position", async () => {
    const texts = [
      "Intro paragraph",
      "Frame one text",
      "Between paragraph",
      "Frame three text",
      "Outro paragraph",
    ];

    const content = await render("/iframes.html");

    const found = positions(content, texts);
    expect(found).not.toContain(-1);
    expect(found).toEqual([...found].sort((a, b) => a - b));
    // data: and javascript: iframes are skipped, not inlined.
    expect(content).not.toContain("Data URL frame text");
    expect(content).not.toContain("Script URL frame text");
  });

  it("includes the content of an open shadow root", async () => {
    const content = await render("/shadow.html");

    expect(content).toContain("Light paragraph");
    expect(content).toContain("Shadow paragraph");
  });

  it("replaces a frameset with the content of its frames, in order", async () => {
    const content = await render("/frameset.html");

    const found = positions(content, ["Navigation frame text", "Main frame text"]);
    expect(found).not.toContain(-1);
    expect(found).toEqual([...found].sort((a, b) => a - b));
  });

  it("takes a frame's content from the rendered frame, not its source", async () => {
    const content = await render("/scripted-frameset.html");

    expect(content).toContain("Scripted frame text");
  });
});
