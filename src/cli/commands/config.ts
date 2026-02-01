import yaml from "yaml";
import type { Argv } from "yargs";
import {
  getConfigValue,
  isValidConfigPath,
  loadConfig,
  parseConfigValue,
  setConfigValue,
} from "../../utils/config";

type OutputFormat = "json" | "yaml" | "auto";

function formatOutput(value: unknown, format: OutputFormat): string {
  // For "auto" format: plain for scalars, JSON for objects
  if (format === "auto") {
    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  if (format === "yaml") {
    return yaml.stringify(value).trim();
  }

  // JSON format
  return JSON.stringify(value, null, 2);
}

export function createConfigCommand(cli: Argv) {
  cli.command(
    "config",
    "View or modify configuration",
    (yargs) => {
      return yargs
        .option("json", {
          type: "boolean",
          description: "Output in JSON format",
          conflicts: "yaml",
        })
        .option("yaml", {
          type: "boolean",
          description: "Output in YAML format",
          conflicts: "json",
        })
        .command(
          "get <path>",
          "Get a configuration value",
          (y) =>
            y
              .positional("path", {
                type: "string",
                description: "Dot-separated config path (e.g., scraper.maxPages)",
                demandOption: true,
              })
              .option("json", {
                type: "boolean",
                description: "Output in JSON format",
                conflicts: "yaml",
              })
              .option("yaml", {
                type: "boolean",
                description: "Output in YAML format",
                conflicts: "json",
              }),
          (argv) => {
            const path = argv.path as string;

            if (!isValidConfigPath(path)) {
              console.error(`Error: Invalid config path '${path}'`);
              console.error("Use 'docs-mcp-server config' to see all available paths.");
              process.exitCode = 1;
              return;
            }

            const config = loadConfig(argv, {
              configPath: argv.config as string,
              searchDir: argv.storePath as string,
            });

            const value = getConfigValue(config, path);
            const format: OutputFormat = argv.json ? "json" : argv.yaml ? "yaml" : "auto";
            console.log(formatOutput(value, format));
          },
        )
        .command(
          "set <path> <value>",
          "Set a configuration value",
          (y) =>
            y
              .positional("path", {
                type: "string",
                description: "Dot-separated config path (e.g., scraper.maxPages)",
                demandOption: true,
              })
              .positional("value", {
                type: "string",
                description: "Value to set",
                demandOption: true,
              }),
          (argv) => {
            const configPath = argv.config as string | undefined;
            const path = argv.path as string;
            const value = argv.value as string;

            // Check for read-only mode (explicit config file specified)
            if (configPath) {
              console.error(
                "Error: Cannot modify configuration when using explicit --config file.",
              );
              console.error(
                "Remove the --config flag to modify the default configuration.",
              );
              process.exitCode = 1;
              return;
            }

            if (!isValidConfigPath(path)) {
              console.error(`Error: Invalid config path '${path}'`);
              console.error("Use 'docs-mcp-server config' to see all available paths.");
              process.exitCode = 1;
              return;
            }

            try {
              const savedPath = setConfigValue(path, value);
              const parsedValue = parseConfigValue(value);
              console.log(`Updated ${path} = ${JSON.stringify(parsedValue)}`);
              console.log(`Saved to: ${savedPath}`);
            } catch (error) {
              console.error(`Error: Failed to save configuration: ${error}`);
              process.exitCode = 1;
            }
          },
        );
    },
    (argv) => {
      // Default behavior: print entire config
      const config = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });

      const format: OutputFormat = argv.json ? "json" : argv.yaml ? "yaml" : "json";
      console.log(formatOutput(config, format));
    },
  );
}
