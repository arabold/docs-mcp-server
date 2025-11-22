/**
 * Remove command - Removes documents for a specific library and version.
 */

import type { Command } from "commander";
import { createDocumentManagement } from "../../store";
import { analytics, TelemetryEvent } from "../../telemetry";
import { getEventBus, getGlobalOptions } from "../utils";

export async function removeAction(
  library: string,
  options: { version?: string; serverUrl?: string },
  command?: Command,
) {
  await analytics.track(TelemetryEvent.CLI_COMMAND, {
    command: "remove",
    library,
    version: options.version,
    useServerUrl: !!options.serverUrl,
  });

  const serverUrl = options.serverUrl;
  const globalOptions = getGlobalOptions(command);

  const eventBus = getEventBus(command);

  // Remove command doesn't need embeddings - explicitly disable for local execution
  const docService = await createDocumentManagement({
    serverUrl,
    embeddingConfig: serverUrl ? undefined : null,
    storePath: globalOptions.storePath,
    eventBus,
  });
  const { version } = options;
  try {
    // Call the document service directly - we could convert this to use RemoveTool if needed
    await docService.removeAllDocuments(library, version);

    console.log(`✅ Successfully removed ${library}${version ? `@${version}` : ""}.`);
  } catch (error) {
    console.error(
      `❌ Failed to remove ${library}${version ? `@${version}` : ""}:`,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    await docService.shutdown();
  }
}

export function createRemoveCommand(program: Command): Command {
  return program
    .command("remove <library>")
    .description("Remove documents for a specific library and version")
    .option(
      "-v, --version <string>",
      "Version to remove (optional, removes unversioned if omitted)",
    )
    .option(
      "--server-url <url>",
      "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
    )
    .action(removeAction);
}
