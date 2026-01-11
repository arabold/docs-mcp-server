import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TarAdapter } from "../TarAdapter";

const TEMP_DIR = path.join(os.tmpdir(), `archive-tests-${Date.now()}`);

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

describe("TarAdapter (Integration)", () => {
  const tarPath = path.join(TEMP_DIR, "test.tar");

  beforeAll(async () => {
    // Create a tar file
    fs.writeFileSync(path.join(TEMP_DIR, "file1.txt"), "content1");
    fs.mkdirSync(path.join(TEMP_DIR, "subdir"));
    fs.writeFileSync(path.join(TEMP_DIR, "subdir/file2.txt"), "content2");

    await tar.c(
      {
        file: tarPath,
        cwd: TEMP_DIR,
      },
      ["file1.txt", "subdir/file2.txt"],
    );
  });

  afterAll(() => {
    // cleanup
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  });

  it("should list entries", async () => {
    const adapter = new TarAdapter(tarPath);
    const entries = [];
    for await (const entry of adapter.listEntries()) {
      entries.push(entry);
    }

    expect(entries.length).toBeGreaterThanOrEqual(2);
    const file1 = entries.find((e) => e.path === "file1.txt" || e.path === "./file1.txt");
    expect(file1).toBeDefined();
    expect(file1?.type).toBe("file");

    const file2 = entries.find((e) => e.path.includes("file2.txt"));
    expect(file2).toBeDefined();
  });

  it("should get content", async () => {
    const adapter = new TarAdapter(tarPath);
    const content = await adapter.getContent("file1.txt");
    expect(content.toString()).toBe("content1");

    const content2 = await adapter.getContent("subdir/file2.txt");
    expect(content2.toString()).toBe("content2");
  });
});
