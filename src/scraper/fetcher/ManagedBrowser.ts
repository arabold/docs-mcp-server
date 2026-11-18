import { type Browser, chromium } from "playwright";
import { ScraperAccessPolicy } from "../../utils/accessPolicy";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { withTimeout } from "../../utils/timeout";
import { type ObscuraServer, startObscura } from "./obscura";

/**
 * Owns one Obscura process for a scrape. Each fetch or render gets a separate
 * CDP connection because Obscura keeps request interception state per connection.
 */
export class ManagedBrowser {
  private server: ObscuraServer | undefined;
  private launching: Promise<ObscuraServer> | undefined;
  private readonly connections = new Map<Browser, ObscuraServer>();
  private readonly accessPolicy: ScraperAccessPolicy;

  /**
   * @param scraperConfig - Browser startup and cleanup timeouts and network policy.
   */
  constructor(private readonly scraperConfig: AppConfig["scraper"]) {
    this.accessPolicy = new ScraperAccessPolicy(scraperConfig.security);
  }

  /**
   * Checks whether the connection and the process it belongs to are still current.
   * @param browser - The connection returned by get().
   * @returns Whether the connection can still be used.
   */
  isCurrent(browser: Browser): boolean {
    const server = this.connections.get(browser);
    return server === this.server && !!server?.isRunning() && browser.isConnected();
  }

  /**
   * Opens an isolated CDP connection, lazily starting the shared process.
   * @returns A Playwright connection. Release it after completing the page.
   */
  async get(): Promise<Browser> {
    const server = await this.getServer();
    const browser = await chromium.connectOverCDP(server.endpoint, {
      headers: { Authorization: `Bearer ${server.token}` },
      noDefaults: true,
      timeout: this.scraperConfig.browserTimeoutMs,
    });
    if (server !== this.server || !server.isRunning()) {
      await browser.close();
      throw new Error("Obscura stopped while opening a CDP connection");
    }
    this.connections.set(browser, server);
    return browser;
  }

  /**
   * Closes an operation's connection. A stuck connection retires its process.
   * @param browser - The connection to release.
   */
  async release(browser: Browser): Promise<void> {
    if (!this.connections.has(browser)) return;
    try {
      await withTimeout(
        browser.close(),
        this.scraperConfig.pageTimeoutMs,
        "Obscura CDP close",
      );
    } catch (error) {
      await this.retire(browser, `CDP close failed: ${error}`);
    } finally {
      this.connections.delete(browser);
    }
  }

  /**
   * Stops the process behind a stuck connection and invalidates its other connections.
   * @param browser - A connection belonging to the process to stop.
   * @param reason - Why the process is being retired.
   */
  async retire(browser: Browser, reason: string): Promise<void> {
    const server = this.connections.get(browser);
    if (server && server === this.server) {
      logger.debug(`Stopping Obscura (${reason})`);
      await this.stopServer(server);
    }
  }

  /**
   * Closes the shared process, including one whose startup is still in flight.
   */
  async close(): Promise<void> {
    await this.launching?.catch(() => undefined);
    if (this.server) await this.stopServer(this.server);
  }

  private async getServer(): Promise<ObscuraServer> {
    if (this.server?.isRunning()) return this.server;
    this.launching ??= this.replaceServer().finally(() => {
      this.launching = undefined;
    });
    return this.launching;
  }

  private async replaceServer(): Promise<ObscuraServer> {
    if (this.server) await this.stopServer(this.server);
    const server = await startObscura(
      this.accessPolicy,
      this.scraperConfig.browserTimeoutMs,
    );
    this.server = server;
    return server;
  }

  private async stopServer(server: ObscuraServer): Promise<void> {
    this.server = undefined;
    for (const [browser, owner] of this.connections) {
      if (owner === server) {
        this.connections.delete(browser);
        void browser.close().catch(() => undefined);
      }
    }
    try {
      await withTimeout(
        server.close(),
        this.scraperConfig.pageTimeoutMs,
        "Obscura shutdown",
      );
    } catch (error) {
      logger.warn(`⚠️ Obscura shutdown failed: ${error}`);
    }
  }
}
