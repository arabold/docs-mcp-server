/** Supported platform and CPU pair for a native MCPB artifact. */
export interface McpbTarget {
  label: string;
  platform: "darwin" | "win32";
  arch: "arm64" | "x64";
}

/** Package metadata used to populate the MCPB manifest. */
export interface McpbPackageMetadata {
  name: string;
  version: string;
  description: string;
  author: string | { name: string };
}

/** Minimal MCPB manifest shape produced by this project. */
export interface McpbManifest {
  manifest_version: "0.3";
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: { name: string };
  repository: { type: "git"; url: string };
  documentation: string;
  support: string;
  license: "MIT";
  keywords: string[];
  server: {
    type: "node";
    entry_point: string;
    mcp_config: {
      command: "node";
      args: string[];
    };
  };
  tools: Array<{ name: string; description: string }>;
  tools_generated: false;
  compatibility: {
    platforms: Array<"darwin" | "win32">;
    runtimes: { node: ">=22" };
  };
}

/** Native targets published for Claude Desktop. */
export const MCPB_TARGETS = {
  "windows-x64": { label: "windows-x64", platform: "win32", arch: "x64" },
  "macos-x64": { label: "macos-x64", platform: "darwin", arch: "x64" },
  "macos-arm64": {
    label: "macos-arm64",
    platform: "darwin",
    arch: "arm64",
  },
} as const satisfies Record<string, McpbTarget>;

/** Creates the release filename for a platform-specific MCPB artifact. */
export function createMcpbArtifactName(version: string, target: McpbTarget): string {
  return `lib-docs-${version}-${target.label}.mcpb`;
}

/** Prevents native dependencies from being packaged for a different host target. */
export function assertNativeTarget(
  target: McpbTarget,
  actualPlatform: string = process.platform,
  actualArch: string = process.arch,
): void {
  if (target.platform !== actualPlatform || target.arch !== actualArch) {
    throw new Error(
      `${target.label} must be built on ${target.platform}/${target.arch}; current host is ${actualPlatform}/${actualArch}.`,
    );
  }
}

/** Creates the validated manifest contract shared by all platform builds. */
export function createMcpbManifest(
  packageMetadata: McpbPackageMetadata,
  target: McpbTarget,
): McpbManifest {
  const authorName =
    typeof packageMetadata.author === "string"
      ? packageMetadata.author
      : packageMetadata.author.name;

  return {
    manifest_version: "0.3",
    name: "lib-docs",
    display_name: "lib-docs",
    version: packageMetadata.version,
    description:
      "Search and read a local Grounded Docs index without exposing modification tools.",
    author: { name: authorName },
    repository: {
      type: "git",
      url: "https://github.com/arabold/docs-mcp-server.git",
    },
    documentation: "https://github.com/arabold/docs-mcp-server#readme",
    support: "https://github.com/arabold/docs-mcp-server/issues",
    license: "MIT",
    keywords: ["documentation", "search", "read-only"],
    server: {
      type: "node",
      entry_point: "mcpb-dist/index.js",
      mcp_config: {
        command: "node",
        args: ["--enable-source-maps", `\${__dirname}/mcpb-dist/index.js`],
      },
    },
    tools: [
      {
        name: "search_docs",
        description: "Search indexed documentation for a library or package.",
      },
      {
        name: "list_libraries",
        description: "List all indexed documentation libraries.",
      },
      {
        name: "find_version",
        description: "Find the best matching indexed version for a library.",
      },
    ],
    tools_generated: false,
    compatibility: {
      platforms: [target.platform],
      runtimes: { node: ">=22" },
    },
  };
}
