import type { Argv } from "yargs";
import {
  getConfigValue,
  isValidConfigPath,
  loadConfig,
  parseConfigValue,
  setConfigValue,
} from "../../utils/config";
import {
  renderScalarOutput,
  renderStructuredOutput,
  renderTextOutput,
  reportCliError,
} from "../output";

function validateConfigPath(path: string): boolean {
  return isValidConfigPath(path);
}

export function createConfigCommand(cli: Argv) {
  cli.command(
    "config [action] [path] [value]",
    "View or modify configuration",
    (yargs) =>
      yargs
        .positional("action", {
          type: "string",
        })
        .positional("path", {
          type: "string",
        })
        .positional("value", {
          type: "string",
        }),
    (argv) => {
      const action = argv.action as string | undefined;

      if (!action) {
        const config = loadConfig(argv, {
          configPath: argv.config as string,
          searchDir: argv.storePath as string,
        });
        renderStructuredOutput(config, argv);
        return;
      }

      if (action !== "get" && action !== "set") {
        reportCliError(`Error: Unknown config action '${action}'. Use 'get' or 'set'.`);
        process.exitCode = 1;
        return;
      }

      if (action === "get") {
        const path = argv.path as string | undefined;
        if (!path || !validateConfigPath(path)) {
          reportCliError(`Error: Invalid config path '${path ?? ""}'`);
          reportCliError("Use 'docs-mcp-server config' to see all available paths.");
          process.exitCode = 1;
          return;
        }

        const config = loadConfig(argv, {
          configPath: argv.config as string,
          searchDir: argv.storePath as string,
        });

        const value = getConfigValue(config, path);
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          renderScalarOutput(value, argv);
          return;
        }

        renderStructuredOutput(value, argv);
        return;
      }

      const path = argv.path as string | undefined;
      const value = argv.value as string | undefined;

      if (!path || !value) {
        reportCliError("Error: config set requires both <path> and <value>.");
        process.exitCode = 1;
        return;
      }

      if (argv.config) {
        reportCliError(
          "Error: Cannot modify configuration when using explicit --config file.",
        );
        reportCliError("Remove the --config flag to modify the default configuration.");
        process.exitCode = 1;
        return;
      }

      if (!validateConfigPath(path)) {
        reportCliError(`Error: Invalid config path '${path}'`);
        reportCliError("Use 'docs-mcp-server config' to see all available paths.");
        process.exitCode = 1;
        return;
      }

      const config = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });
      const currentValue = getConfigValue(config, path);
      if (
        currentValue !== undefined &&
        currentValue !== null &&
        typeof currentValue === "object" &&
        !Array.isArray(currentValue)
      ) {
        reportCliError(
          `Error: Config path '${path}' refers to an object. Use a more specific leaf path to set a scalar value.`,
        );
        reportCliError(
          "Hint: Run 'docs-mcp-server config' to inspect the current structure.",
        );
        process.exitCode = 1;
        return;
      }

      try {
        const savedPath = setConfigValue(path, value);
        const parsedValue = parseConfigValue(value);
        renderTextOutput(`Updated ${path} = ${JSON.stringify(parsedValue)}`);
        renderTextOutput(`Saved to: ${savedPath}`);
      } catch (error) {
        reportCliError(
          `Error: Failed to save configuration: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exitCode = 1;
      }
    },
  );
}
