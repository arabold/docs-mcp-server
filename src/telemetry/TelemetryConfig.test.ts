import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateInstallationId } from "./TelemetryConfig";

describe("generateInstallationId", () => {
  let storePath: string;

  beforeEach(() => {
    storePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-installation-")),
      "store",
    );
  });

  afterEach(() => {
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
  });

  it("stores a new UUID in the store path and returns the same one afterwards", () => {
    const id = generateInstallationId(storePath);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(fs.readFileSync(path.join(storePath, "installation.id"), "utf8")).toBe(id);
    expect(generateInstallationId(storePath)).toBe(id);
  });
});
