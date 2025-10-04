/**
 * List command - Lists all available libraries and their versions.
 */

import type { Command } from "commander";
import { createDocumentManagement } from "../../store";
import { analytics, TelemetryEvent } from "../../telemetry";
import { ListLibrariesTool } from "../../tools";
import { formatOutput } from "../utils";

export async function listAction(options: { serverUrl?: string }, command?: Command) {
  await analytics.track(TelemetryEvent.CLI_COMMAND, {
    command: "list",
    useServerUrl: !!options.serverUrl,
  });

  const { serverUrl } = options;

  // Get global options from root command (which has resolved storePath in preAction hook)
  let rootCommand = command;
  while (rootCommand?.parent) {
    rootCommand = rootCommand.parent;
  }
  const globalOptions = rootCommand?.opts() || {};

  // List command doesn't need embeddings - explicitly disable for local execution
  const docService = await createDocumentManagement({
    serverUrl,
    embeddingConfig: serverUrl ? undefined : null,
    storePath: globalOptions.storePath,
  });
  try {
    const listLibrariesTool = new ListLibrariesTool(docService);

    // Call the tool directly - tracking is now handled inside the tool
    const result = await listLibrariesTool.execute();

    console.log(formatOutput(result.libraries));
  } finally {
    await docService.shutdown();
  }
}

export function createListCommand(program: Command): Command {
  return program
    .command("list")
    .description("List all available libraries and their versions")
    .option(
      "--server-url <url>",
      "URL of external pipeline worker RPC (e.g., http://localhost:6280/api)",
    )
    .action(listAction);
}
