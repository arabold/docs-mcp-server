/** Tests for the fetch-url command */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import yargs from "yargs";
import { HTML_FIXTURE_URL, writeTestConfig } from "../../../test/test-helpers";
import { telemetry } from "../../telemetry";
import { FetchUrlTool } from "../../tools";
import { createFetchUrlCommand } from "./fetchUrl";

vi.mock("../../telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../telemetry")>()),
  telemetry: { track: vi.fn() },
}));

describe("fetch-url command", () => {
  let stdoutWriteSpy: MockInstance<typeof process.stdout.write>;
  let configDir = "";

  beforeEach(() => {
    vi.clearAllMocks();
    // These pages are fetched without a browser, so none needs installing
    vi.stubEnv("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1");
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    configDir = mkdtempSync(path.join(tmpdir(), "fetch-url-command-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(configDir, { recursive: true, force: true });
  });

  /** Runs the command with a config that lets it read local files. */
  async function run(args: string[]): Promise<void> {
    const parser = yargs().scriptName("test");
    createFetchUrlCommand(parser);
    await parser.parse([...args, "--config", writeTestConfig(configDir)]);
  }

  it("prints the page at a file URL as Markdown", async () => {
    await run(["fetch-url", HTML_FIXTURE_URL, "--scrape-mode", "fetch"]);

    const printed = stdoutWriteSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(printed).toContain("# Herman Melville - Moby-Dick");
    expect(printed).toContain("the blacksmith");
    expect(printed).not.toContain("<h1>");
  });

  it("sends only the host of the URL to telemetry", async () => {
    // Nothing is fetched; only what reaches telemetry matters here
    vi.spyOn(FetchUrlTool.prototype, "execute").mockResolvedValue("");

    await run(["fetch-url", "https://intranet.example.com/team/secret?q=1"]);

    const [, properties] = vi.mocked(telemetry.track).mock.calls[0];
    expect(properties).toMatchObject({
      url: "intranet.example.com",
      urlProtocol: "https",
    });
    expect(JSON.stringify(properties)).not.toContain("secret");
  });
});
