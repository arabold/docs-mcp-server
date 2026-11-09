/**
 * End-to-end tests for indexing a local archive.
 *
 * A scrape of a `file://` URL that names a ZIP or TAR archive, plain or
 * gzipped, stores every member under a URL inside the archive, such as
 * `file:///docs/archive.zip/guide.md`, and search finds the members' text.
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { usePipelineHarness } from "./pipeline-harness";

// Resolved, because the file access policy does not follow symlinks by default.
const FIXTURES_DIR = realpathSync(path.join(import.meta.dirname, "fixtures"));

/** The files in `archive.zip`. */
const ZIP_MEMBERS = [
  "html.html",
  "json.json",
  "robots.txt",
  "sample.docx",
  "sample.ipynb",
  "sample.pdf",
  "sample.pptx",
  "sample.xlsx",
  "xml.xml",
];

/** The `file://` URL of `archive`, percent-encoded the way stored URLs are. */
const archiveUrl = (archive: string) => pathToFileURL(path.join(FIXTURES_DIR, archive)).href;

/** The URL a member of `archive` is stored under. */
const memberUrl = (archive: string, member: string) => `${archiveUrl(archive)}/${member}`;

describe("Local archive E2E", () => {
  const h = usePipelineHarness({
    library: "archive-lib",
    version: "1.0.0",
    // The fixtures sit under test/, a folder the default exclusions skip
    defaults: { excludePatterns: [] },
  });

  beforeEach(() => {
    h.config.scraper.security.fileAccess.allowedRoots = [FIXTURES_DIR];
  });

  it("indexes the members of a ZIP archive", async () => {
    const job = await h.scrape({ url: archiveUrl("archive.zip") });

    expect(job.status, job.errorMessage ?? undefined).toBe(PipelineJobStatus.COMPLETED);
    expect(await h.storedUrls()).toEqual(
      ZIP_MEMBERS.map((member) => memberUrl("archive.zip", member)).sort(),
    );
    const hits = await h.search("old blacksmith");
    expect(hits.map((hit) => hit.url)).toContain(memberUrl("archive.zip", "html.html"));
  });

  it.each(["archive.tar", "archive.tgz"])("indexes the members of %s", async (archive) => {
    const job = await h.scrape({ url: archiveUrl(archive) });

    expect(job.status, job.errorMessage ?? undefined).toBe(PipelineJobStatus.COMPLETED);
    expect(await h.storedUrls()).toEqual([
      memberUrl(archive, "guide.md"),
      memberUrl(archive, "nested/notes.txt"),
    ]);
    const hits = await h.search("lighthouse keeper");
    expect(hits.map((hit) => hit.url)).toContain(memberUrl(archive, "guide.md"));
  });
});
