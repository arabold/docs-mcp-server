/**
 * Fetch URL command - Fetches a URL and converts its content to Markdown.
 */

import type { Command } from "commander";
import { FileFetcher, HttpFetcher } from "../../scraper/fetcher";
import { ScrapeMode } from "../../scraper/types";
import { analytics, TelemetryEvent } from "../../telemetry";
import { FetchUrlTool } from "../../tools";
import { parseHeaders } from "../utils";

export async function fetchUrlAction(
  url: string,
  options: { followRedirects: boolean; scrapeMode: ScrapeMode; header: string[] },
) {
  await analytics.track(TelemetryEvent.CLI_COMMAND, {
    command: "fetch-url",
    url,
    scrapeMode: options.scrapeMode,
    followRedirects: options.followRedirects,
    hasHeaders: options.header.length > 0,
  });

  const headers = parseHeaders(options.header);
  const fetchUrlTool = new FetchUrlTool(new HttpFetcher(), new FileFetcher());

  const content = await fetchUrlTool.execute({
    url,
    followRedirects: options.followRedirects,
    scrapeMode: options.scrapeMode,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });

  console.log(content);
}

export function createFetchUrlCommand(program: Command): Command {
  return program
    .command("fetch-url <url>")
    .description("Fetch a URL and convert its content to Markdown")
    .option(
      "--no-follow-redirects",
      "Disable following HTTP redirects (default: follow redirects)",
    )
    .option(
      "--scrape-mode <mode>",
      `HTML processing strategy: '${ScrapeMode.Fetch}', '${ScrapeMode.Playwright}', '${ScrapeMode.Auto}' (default)`,
      (value: string): ScrapeMode => {
        const validModes = Object.values(ScrapeMode);
        if (!validModes.includes(value as ScrapeMode)) {
          console.warn(
            `Warning: Invalid scrape mode '${value}'. Using default '${ScrapeMode.Auto}'.`,
          );
          return ScrapeMode.Auto;
        }
        return value as ScrapeMode;
      },
      ScrapeMode.Auto,
    )
    .option(
      "--header <name:value>",
      "Custom HTTP header to send with the request (can be specified multiple times)",
      (val: string, prev: string[] = []) => prev.concat([val]),
      [] as string[],
    )
    .action(fetchUrlAction);
}
