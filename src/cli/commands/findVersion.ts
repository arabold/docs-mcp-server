/**
 * Find version command - Finds the best matching version for a library.
 */

import type { Command } from "commander";
import { createDocumentManagement } from "../../store";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { FindVersionTool } from "../../tools";
import { loadConfig } from "../../utils/config";
import { getEventBus, getGlobalOptions } from "../utils";

export async function findVersionAction(
  library: string,
  options: { version?: string; serverUrl?: string },
  command?: Command,
) {
  await telemetry.track(TelemetryEvent.CLI_COMMAND, {
    command: "find-version",
    library,
    version: options.version,
    useServerUrl: !!options.serverUrl,
  });

  const serverUrl = options.serverUrl;
  const globalOptions = getGlobalOptions(command);
  const appConfig = loadConfig();

  appConfig.app.storePath = globalOptions.storePath ?? appConfig.app.storePath;

  const eventBus = getEventBus(command);

  // Find version command doesn't need embeddings - explicitly disable for local execution
  const docService = await createDocumentManagement({
    serverUrl,
    eventBus,
    appConfig: appConfig,
  });
  try {
    const findVersionTool = new FindVersionTool(docService);

    // Call the tool directly - tracking is now handled inside the tool
    const versionInfo = await findVersionTool.execute({
      library,
      targetVersion: options.version,
    });

    if (!versionInfo) throw new Error("Failed to get version information");
    console.log(versionInfo);
  } finally {
    await docService.shutdown();
  }
}

export function createFindVersionCommand(program: Command): Command {
  return program
    .command("find-version <library>")
    .description("Find the best matching version for a library")
    .option("-v, --version <string>", "Pattern to match (optional, supports ranges)")
    .option(
      "--server-url <url>",
      "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
    )
    .action(findVersionAction);
}
