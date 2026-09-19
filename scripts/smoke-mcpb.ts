import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DocumentStore } from "../src/store/DocumentStore";
import { type AppConfig, defaults } from "../src/utils/config";

const MCPB_CLI = "@anthropic-ai/mcpb@2.1.2";

function findArtifact(input: string): string {
  const resolved = path.resolve(input);
  if (resolved.endsWith(".mcpb")) return resolved;
  const artifacts = readdirSync(resolved)
    .filter((entry) => entry.endsWith(".mcpb"))
    .map((entry) => path.join(resolved, entry));
  if (artifacts.length !== 1) {
    throw new Error(`Expected exactly one .mcpb in ${resolved}, found ${artifacts.length}.`);
  }
  return artifacts[0];
}

async function main(): Promise<void> {
  const artifact = findArtifact(process.argv[2] ?? "artifacts");
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "grounded-docs-mcpb-smoke-"));
  const unpacked = path.join(temporaryRoot, "unpacked");
  const storePath = path.join(temporaryRoot, "store");

  try {
    execFileSync(
      "npx",
      ["-y", MCPB_CLI, "unpack", artifact, unpacked],
      { shell: process.platform === "win32", stdio: "inherit" },
    );

    const config: AppConfig = {
      ...defaults,
      app: { ...defaults.app, storePath, embeddingModel: "" },
    };
    mkdirSync(storePath, { recursive: true });
    const writableStore = new DocumentStore(path.join(storePath, "documents.db"), config);
    await writableStore.initialize();
    await writableStore.shutdown();

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(unpacked, "mcpb-dist", "index.js")],
      cwd: unpacked,
      env: {
        ...process.env,
        DOCS_MCP_STORE_PATH: storePath,
        DOCS_MCP_TELEMETRY: "false",
      },
      stderr: "pipe",
    });
    let serverStderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      serverStderr += chunk.toString();
    });
    const client = new Client({ name: "mcpb-smoke", version: "1.0.0" });
    let tools: Awaited<ReturnType<typeof client.listTools>>;
    try {
      await client.connect(transport);
      tools = await client.listTools();
      await client.close();
    } catch (error) {
      const details = serverStderr.trim();
      throw new Error(
        details.length > 0 ? `${error}\nPackaged server stderr:\n${details}` : String(error),
      );
    }

    const names = tools.tools.map((tool) => tool.name).sort();
    const expected = ["find_version", "list_libraries", "search_docs"];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected MCPB tools: ${names.join(", ")}.`);
    }

    console.log(`✅ MCPB smoke passed: ${path.basename(artifact)} (${names.join(", ")})`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`❌ MCPB smoke failed: ${error}`);
  process.exit(1);
});
