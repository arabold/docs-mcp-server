/**
 * E2E repro for GitHub issue #394 — "PDFs ignored in volume".
 *
 * Reporter: pointing the docs server at a directory via `file:///docs`,
 * `.txt` files get indexed but `.pdf` files are silently skipped.
 *
 * Goal of this test: drive `LocalFileStrategy.scrape()` end-to-end against a
 * real on-disk directory containing a real PDF (the same fixture used by
 * `DocumentPipeline.test.ts`), plus a `.txt` and a `.md`, and observe whether
 * the progress callback ever receives a result for the PDF with extracted
 * `textContent`.
 *
 * If this test passes → the in-process pipeline works; the production bug is
 * environmental (likely Kreuzberg native deps missing in the Docker image, or
 * the `document.maxSize` 10 MB cap).
 * If this test fails → we have an in-code regression and the assertions show
 * exactly where it broke.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFileStrategy } from "../src/scraper/strategies/LocalFileStrategy";
import type {
  ScrapeResult,
  ScraperOptions,
  ScraperProgressEvent,
} from "../src/scraper/types";
import type { ProgressCallback } from "../src/types";
import { loadConfig } from "../src/utils/config";

const FIXTURE_PDF = path.join(__dirname, "fixtures", "sample.pdf");

describe("LocalFileStrategy - PDF in mounted directory (issue #394)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-issue394-"));

    // The exact files the reporter described: a .txt that "works" and a PDF
    // that is "ignored". Add a .md to cover the second commenter's case.
    fs.copyFileSync(FIXTURE_PDF, path.join(tmpDir, "sample.pdf"));
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "plain text note");
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "# Readme\n\nbody");
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("indexes a PDF sitting next to .txt/.md in a directory served via file://", async () => {
    const appConfig = loadConfig();
    // This test points at an OS temp directory that lives outside the default
    // `$DOCUMENTS` allowed root. The new scraper security policy would block
    // it unless we widen the allowed roots to include this run's tmpDir.
    // On macOS, `/var/folders/...` is itself reached via a symlinked ancestor
    // (`/var` → `/private/var`), so we also need to permit symlink traversal
    // for the policy to read fixture files.
    appConfig.scraper.security.fileAccess.allowedRoots = [tmpDir];
    appConfig.scraper.security.fileAccess.followSymlinks = true;
    const strategy = new LocalFileStrategy(appConfig);

    const dirUrl = `file://${tmpDir}`;
    const options: ScraperOptions = {
      url: dirUrl,
      library: "issue-394",
      version: "1.0",
      maxPages: 10,
      maxDepth: 1,
      maxConcurrency: 1,
    };

    const events: ScraperProgressEvent[] = [];
    const progressCallback: ProgressCallback<ScraperProgressEvent> = async (
      event,
    ) => {
      events.push(event);
    };

    await strategy.scrape(options, progressCallback);
    await strategy.cleanup();

    // What was actually processed
    const byUrl = new Map<string, ScrapeResult | null | undefined>();
    for (const e of events) {
      byUrl.set(e.currentUrl, e.result);
    }
    console.log(
      "[issue-394] processed URLs:",
      events.map((e) => `${e.currentUrl} (chunks=${e.result?.chunks?.length ?? 0})`),
    );

    // .txt baseline — the reporter says this works today
    const txtResult = byUrl.get(`file://${tmpDir}/notes.txt`);
    expect(txtResult, "notes.txt should be processed").toBeTruthy();

    // The bug under test: the PDF must show up with extracted content
    const pdfResult = byUrl.get(`file://${tmpDir}/sample.pdf`);
    expect(pdfResult, "sample.pdf should be processed (issue #394)").toBeTruthy();
    expect(pdfResult?.sourceContentType).toBe("application/pdf");
    expect(
      (pdfResult?.textContent ?? "").trim().length,
      "PDF should produce non-empty extracted text",
    ).toBeGreaterThan(0);
    expect(
      pdfResult?.chunks?.length ?? 0,
      "PDF should produce at least one chunk",
    ).toBeGreaterThan(0);

    // Second commenter said .md also failed for them
    const mdResult = byUrl.get(`file://${tmpDir}/readme.md`);
    expect(mdResult, "readme.md should be processed").toBeTruthy();
    expect((mdResult?.textContent ?? "").trim().length).toBeGreaterThan(0);
  });
});
