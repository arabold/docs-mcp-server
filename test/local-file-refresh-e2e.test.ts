/**
 * End-to-end tests for refreshing a version indexed from a local directory.
 *
 * A `file://` refresh decides what changed from each file's modification time,
 * which its stored validator is derived from: a file whose mtime moved is read
 * again, an untouched file is skipped, and a missing file is deleted. The files
 * are real, in a temporary directory, and modification times are set explicitly
 * so no test waits for the clock to move.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome } from "../src/scraper/types";
import { usePipelineHarness } from "./pipeline-harness";

const INDEXED_AT = new Date("2024-01-01T00:00:00Z");
const EDITED_AT = new Date("2024-06-01T00:00:00Z");

describe("Local file refresh E2E", () => {
  const h = usePipelineHarness({ library: "file-lib", version: "1.0.0" });
  let root: string;

  beforeEach(async () => {
    // Resolved, because on macOS the temp directory sits behind a symlink and
    // the file access policy does not follow symlinks by default.
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "docs-mcp-refresh-")),
    );
    h.config.scraper.security.fileAccess.allowedRoots = [root];
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** Writes a file into the directory with a fixed modification time. */
  async function writeDoc(name: string, content: string, mtime = INDEXED_AT) {
    const file = path.join(root, name);
    await fs.writeFile(file, content);
    await fs.utimes(file, mtime, mtime);
  }

  const fileUrl = (name: string) => `file://${root}/${name}`;

  it("picks up new, modified and deleted files", async () => {
    await writeDoc("index.md", "# Home\n\nWelcome to the docs");
    await writeDoc("guide.md", "# Guide\n\nOriginal guide content");
    await writeDoc("api.md", "# API\n\nAPI documentation");
    await h.scrape({ url: `file://${root}` });
    expect(await h.storedUrls()).toEqual(
      [fileUrl("api.md"), fileUrl("guide.md"), fileUrl("index.md")].sort(),
    );

    await fs.rm(path.join(root, "api.md"));
    await writeDoc(
      "guide.md",
      "# Guide\n\nUpdated guide content with new information",
      EDITED_AT,
    );
    await writeDoc("tutorial.md", "# Tutorial\n\nStep-by-step tutorial");
    const refresh = await h.refresh();

    expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
    expect(await h.storedUrls()).toEqual(
      [fileUrl("guide.md"), fileUrl("index.md"), fileUrl("tutorial.md")].sort(),
    );
    expect(h.outcomeOf(fileUrl("index.md"))).toBe(PageOutcome.Unchanged);
    expect(await h.contentOf(fileUrl("guide.md"))).toContain("Updated guide content");
    expect(await h.contentOf(fileUrl("tutorial.md"))).toContain("Step-by-step tutorial");
    const deleted = await h.search("API documentation");
    expect(deleted.map((r) => r.url)).not.toContain(fileUrl("api.md"));
  });

  it("leaves unchanged files alone", async () => {
    await writeDoc("doc1.md", "# Document 1\n\nStable content");
    await writeDoc("doc2.md", "# Document 2\n\nStable content");
    await h.scrape({ url: `file://${root}` });

    const refresh = await h.refresh();

    expect(refresh.status).toBe(PipelineJobStatus.COMPLETED);
    expect(h.outcomeOf(fileUrl("doc1.md"))).toBe(PageOutcome.Unchanged);
    expect(h.outcomeOf(fileUrl("doc2.md"))).toBe(PageOutcome.Unchanged);
    expect(await h.storedUrls()).toEqual([fileUrl("doc1.md"), fileUrl("doc2.md")]);
    expect(await h.contentOf(fileUrl("doc1.md"))).toContain("Stable content");
  });
});
