import fs from "node:fs";
import { type Browser, chromium, type LaunchOptions } from "playwright";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { withTimeout } from "../../utils/timeout";

/**
 * Process IDs of the browsers `ManagedBrowser.launch()` started. Playwright's
 * `Browser` does not expose its process, so the ID is read over CDP at launch,
 * while the browser still answers.
 */
const browserPids = new WeakMap<Browser, number>();

/**
 * One headless Chromium that the browser fetcher and the HTML renderer can
 * share, so a scrape runs a single browser process.
 *
 * The browser is launched on first use and launched again after it exits;
 * callers that ask at the same time share one launch. Closing is safe to
 * repeat and does not stop later use: the next `get()` launches a new one.
 */
export class ManagedBrowser {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly closeTimeoutMs: number;

  constructor(scraperConfig: AppConfig["scraper"]) {
    this.closeTimeoutMs = scraperConfig.pageTimeoutMs;
  }

  /**
   * Returns a connected browser, launching one on first use and again after
   * Chromium has exited. Concurrent callers share a single launch.
   */
  async get(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    this.launching ??= this.replaceBrowser().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  /**
   * Closes the given browser, killing its process if it does not close in
   * time. Use it for a browser that may be stuck; when it is the current one,
   * the next `get()` launches a new browser.
   *
   * @param browser - The browser to close.
   * @param reason - Why it is closed, for the logs.
   */
  async retire(browser: Browser, reason: string): Promise<void> {
    if (this.browser === browser) {
      this.browser = null;
    }

    logger.debug(`Closing Playwright browser (${reason})`);
    try {
      // A disconnected browser is closed too, which reaps its process.
      await withTimeout(browser.close(), this.closeTimeoutMs, "Playwright browser close");
    } catch (error) {
      logger.warn(`⚠️  Error closing Playwright browser (${reason}): ${error}`);
      ManagedBrowser.killProcess(browser, reason);
    }
  }

  /**
   * Closes the browser, including one whose launch is still in flight.
   */
  async close(): Promise<void> {
    await this.launching?.catch(() => undefined);
    if (this.browser) {
      await this.retire(this.browser, "shutdown");
    }
  }

  private async replaceBrowser(): Promise<Browser> {
    if (this.browser) {
      logger.warn("⚠️  Browser disconnected, launching a new one");
      // Reap the dead process without holding up the launch.
      void this.retire(this.browser, "disconnected");
    } else {
      logger.debug("Launching browser...");
    }

    this.browser = await ManagedBrowser.launch();
    return this.browser;
  }

  /**
   * Launches a headless Chromium for scraping.
   *
   * Without an explicit executable, Playwright launches its headless shell.
   * Installs made with `playwright install --no-shell` leave the shell out and
   * have only the full build, so a missing shell falls back to that.
   *
   * @returns The launched browser; the caller closes it.
   */
  static async launch(): Promise<Browser> {
    const options: LaunchOptions = {
      headless: true,
      executablePath: ManagedBrowser.resolveChromiumExecutablePath(),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    };

    let browser: Browser;
    try {
      browser = await chromium.launch(options);
    } catch (error) {
      const missingExecutable =
        error instanceof Error && error.message.includes("Executable doesn't exist");
      if (options.executablePath || !missingExecutable) {
        throw error;
      }
      logger.debug("Playwright's headless shell is not installed; using the full build");
      browser = await chromium.launch({ ...options, channel: "chromium" });
    }

    await ManagedBrowser.recordProcessId(browser);
    return browser;
  }

  /**
   * Remembers the browser's process ID, so a browser that will not close can
   * still be killed. Best effort: without an ID, the kill is skipped.
   */
  private static async recordProcessId(browser: Browser): Promise<void> {
    try {
      const session = await browser.newBrowserCDPSession();
      const { processInfo } = await session.send("SystemInfo.getProcessInfo");
      await session.detach();
      const pid = processInfo.find((info) => info.type === "browser")?.id;
      if (pid) {
        browserPids.set(browser, pid);
      }
    } catch (error) {
      logger.debug(`Could not read the browser process ID: ${error}`);
    }
  }

  /**
   * Resolves the Chromium binary to launch.
   *
   * Playwright's own managed build is pinned to the installed Playwright
   * version and is always preferred. A distro Chromium is only a fallback for
   * environments that skipped the browser download, since an arbitrary system
   * build can drift from the protocol Playwright expects.
   *
   * @returns An explicit executable path, or undefined to let Playwright choose.
   */
  private static resolveChromiumExecutablePath(): string | undefined {
    const configuredPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (configuredPath) {
      return configuredPath;
    }

    try {
      if (fs.existsSync(chromium.executablePath())) {
        return undefined;
      }
    } catch {
      // executablePath() throws when no managed build is registered at all.
    }

    const systemPath = [
      "/usr/lib/chromium/chromium",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].find((candidate) => fs.existsSync(candidate));

    if (systemPath) {
      logger.debug(
        `Playwright's managed Chromium is unavailable; using system Chromium at ${systemPath}`,
      );
    }
    return systemPath;
  }

  private static killProcess(browser: Browser, reason: string): void {
    const pid = browserPids.get(browser);
    if (!pid) {
      logger.warn(`⚠️  Cannot kill the Playwright browser, its process ID is unknown`);
      return;
    }

    logger.warn(`⚠️  Force killing Playwright browser process pid=${pid}: ${reason}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      // ESRCH: the process has already exited.
      logger.warn(
        `⚠️  Failed to force kill Playwright browser process pid=${pid}: ${error}`,
      );
    }
  }
}
