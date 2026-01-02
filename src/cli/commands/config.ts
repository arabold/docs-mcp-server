import type { Command } from "commander";
import { loadConfig } from "../../utils/config";

export function createConfigCommand(program: Command): Command {
  return program
    .command("config")
    .description("Display the current configuration")
    .action(() => {
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
    });
}
