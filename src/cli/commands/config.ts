import type { Argv } from "yargs";
import { loadConfig } from "../../utils/config";

export function createConfigCommand(cli: Argv) {
  cli.command(
    "config",
    "Fetch a URL and transform it into Markdown format",
    (yargs) => yargs,
    (argv) => {
      const config = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });
      console.log(JSON.stringify(config, null, 2));
    },
  );
}
