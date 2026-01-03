/**
 * Fetch URL command - Fetches a URL and converts its content to Markdown.
 */

import type { Argv } from "yargs";
import { AutoDetectFetcher } from "../../scraper/fetcher";
import { ScrapeMode } from "../../scraper/types";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { FetchUrlTool } from "../../tools";
import { loadConfig } from "../../utils/config";
import { parseHeaders } from "../utils";

export function createFetchUrlCommand(cli: Argv) {
  cli.command(
    "fetch-url <url>",
    "Fetch a URL and transform it into Markdown format",
    (yargs) => {
      return yargs
        .positional("url", {
          type: "string",
          description: "URL to fetch",
          demandOption: true,
        })
        .option("follow-redirects", {
          type: "boolean",
          description: "Follow HTTP redirects",
          default: true,
        })
        .option("no-follow-redirects", {
          type: "boolean",
          description: "Disable following HTTP redirects",
          hidden: true,
        })
        .option("scrape-mode", {
          choices: Object.values(ScrapeMode),
          description: "HTML processing strategy",
          default: ScrapeMode.Auto,
          alias: "scrapeMode",
        })
        .option("header", {
          type: "string",
          array: true,
          description:
            "Custom HTTP header to send with the request (can be specified multiple times)",
          default: [] as string[],
        });
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "fetch-url",
        url: argv.url,
        scrapeMode: argv.scrapeMode,
        followRedirects: argv.followRedirects,
        hasHeaders: (argv.header as string[])?.length > 0,
      });

      const url = argv.url as string;
      // parseHeaders expects string[]. Yargs array option gives string[] | undefined (if not default)
      // We set default: [] above.
      const headers = parseHeaders((argv.header as string[]) || []);

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolved globally
      });

      const fetchUrlTool = new FetchUrlTool(
        new AutoDetectFetcher(appConfig.scraper),
        appConfig,
      );

      const content = await fetchUrlTool.execute({
        url,
        followRedirects: argv.followRedirects as boolean,
        scrapeMode: argv.scrapeMode as ScrapeMode,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      console.log(content);
    },
  );
}
