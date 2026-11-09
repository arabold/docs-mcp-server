/**
 * End-to-end tests for script and style text in Fetch mode.
 *
 * Fetch mode indexes the HTML as served, scripts unexecuted. The sanitizer
 * removes `<script>` and `<style>` elements, but it also falls back to the
 * page's original body when sanitizing leaves no text, so a page whose only
 * text sits in chrome is not indexed blank. These tests cover the pages that
 * reach that fallback and show that it never brings script source or style
 * rules back as page text.
 */

import { describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

/** Fills the page's empty container in a browser; Fetch mode never runs it. */
const SCRIPT =
  'document.getElementById("content").textContent = ["Text","written","by","JavaScript"].join(" ");';

describe("Inline script content in Fetch mode E2E", () => {
  const site = mockSite("http://scripted-docs.example.com");
  const PAGE = site.url("/page");
  const h = usePipelineHarness({
    library: "scripted-lib",
    version: "1.0.0",
    defaults: { url: PAGE, maxPages: 1, maxDepth: 0 },
  });

  it("stores no text for a page whose content only a script writes", async () => {
    site.page(
      "/page",
      `<html><body><main id="content"></main><script>${SCRIPT}</script></body></html>`,
    );

    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

    expect(await h.contentOf(PAGE)).toBe("");
  });

  it("keeps chrome text without the scripts and styles beside it", async () => {
    // Removing the header empties the body, so the sanitizer restores it.
    site.page(
      "/page",
      `<html><head><style>body { color: red; }</style></head><body><header><h1>Release notes</h1></header><main id="content"></main><script>${SCRIPT}</script><style>.note { color: blue; }</style></body></html>`,
    );

    expect((await h.scrape()).status).toBe(PipelineJobStatus.COMPLETED);

    const content = await h.contentOf(PAGE);
    expect(content).toContain("Release notes");
    expect(content).not.toContain("getElementById");
    expect(content).not.toContain("color");
  });
});
