import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "yaml";
import {
  assertNativeTarget,
  createMcpbArtifactName,
  createMcpbManifest,
  MCPB_TARGETS,
} from "./mcpb";

describe("MCPB build contract", () => {
  it("describes a local read-only stdio server without URL fetching", () => {
    const manifest = createMcpbManifest(
      {
        name: "@arabold/docs-mcp-server",
        version: "3.0.0",
        description: "MCP server for fetching and searching documentation",
        author: "grounded.tools",
      },
      MCPB_TARGETS["windows-x64"],
    );

    expect(manifest).toMatchObject({
      manifest_version: "0.3",
      name: "lib-docs",
      display_name: "lib-docs",
      version: "3.0.0",
      server: {
        type: "node",
        entry_point: "mcpb-dist/index.js",
        mcp_config: {
          command: "node",
          args: ["--enable-source-maps", `\${__dirname}/mcpb-dist/index.js`],
        },
      },
      compatibility: {
        platforms: ["win32"],
        runtimes: { node: ">=22" },
      },
    });
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      "search_docs",
      "list_libraries",
      "find_version",
    ]);
  });

  it("defines the three requested native build targets", () => {
    expect(MCPB_TARGETS).toEqual({
      "windows-x64": { label: "windows-x64", platform: "win32", arch: "x64" },
      "macos-x64": { label: "macos-x64", platform: "darwin", arch: "x64" },
      "macos-arm64": {
        label: "macos-arm64",
        platform: "darwin",
        arch: "arm64",
      },
    });
  });

  it("uses a platform-specific artifact name and rejects cross-packaging", () => {
    const target = MCPB_TARGETS["macos-arm64"];

    expect(createMcpbArtifactName("3.0.0", target)).toBe(
      "lib-docs-3.0.0-macos-arm64.mcpb",
    );
    expect(() => assertNativeTarget(target, "linux", "x64")).toThrow(
      "must be built on darwin/arm64",
    );
  });

  it("builds the three requested artifacts on matching native runners", () => {
    const workflow = yaml.parse(
      readFileSync(path.resolve(".github/workflows/mcpb.yml"), "utf8"),
    );

    expect(workflow.jobs.build.strategy.matrix.include).toEqual([
      { target: "windows-x64", runner: "windows-latest" },
      { target: "macos-x64", runner: "macos-15-intel" },
      { target: "macos-arm64", runner: "macos-15" },
    ]);
    expect(workflow.jobs.build.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run: `npm run build:mcpb -- --target \${{ matrix.target }}`,
        }),
        expect.objectContaining({
          run: "npm run smoke:mcpb -- artifacts",
        }),
        expect.objectContaining({
          uses: "actions/upload-artifact@v7",
          with: expect.objectContaining({ path: "artifacts/*.mcpb" }),
        }),
      ]),
    );
  });
});
