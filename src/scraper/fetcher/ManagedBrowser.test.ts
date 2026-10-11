import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(),
    executablePath: vi.fn(),
  },
}));

import { chromium } from "playwright";
import { ManagedBrowser } from "./ManagedBrowser";

/** A mocked Playwright browser with the parts ManagedBrowser touches. */
function buildBrowser() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

/** Makes every launch return a new mocked browser, in launch order. */
function mockLaunches() {
  const launched: ReturnType<typeof buildBrowser>[] = [];
  vi.mocked(chromium.launch).mockImplementation(async () => {
    const browser = buildBrowser();
    launched.push(browser);
    return browser as never;
  });
  return launched;
}

describe("ManagedBrowser", () => {
  const scraperConfig = loadConfig().scraper;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("get", () => {
    it("reuses the browser while it is connected", async () => {
      mockLaunches();
      const managed = new ManagedBrowser(scraperConfig);

      const first = await managed.get();
      const second = await managed.get();

      expect(second).toBe(first);
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });

    it("launches a new browser and closes the old one once Chromium has exited", async () => {
      const launched = mockLaunches();
      const managed = new ManagedBrowser(scraperConfig);

      await managed.get();
      launched[0].isConnected.mockReturnValue(false);
      const replacement = await managed.get();

      expect(replacement).toBe(launched[1]);
      expect(launched[0].close).toHaveBeenCalled();
    });

    it("shares one launch between callers that ask at the same time", async () => {
      mockLaunches();
      const managed = new ManagedBrowser(scraperConfig);

      const browsers = await Promise.all([managed.get(), managed.get(), managed.get()]);

      expect(new Set(browsers).size).toBe(1);
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });

    it("launches again after it was closed", async () => {
      mockLaunches();
      const managed = new ManagedBrowser(scraperConfig);

      await managed.get();
      await managed.close();
      await managed.get();

      expect(chromium.launch).toHaveBeenCalledTimes(2);
    });
  });

  describe("retire", () => {
    it("kills Chromium by the process ID read at launch when it does not close in time", async () => {
      const browser = {
        ...buildBrowser(),
        close: vi.fn(() => new Promise(() => {})),
        // Chromium reports its own process ID over CDP.
        newBrowserCDPSession: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({
            processInfo: [
              { type: "GPU", id: 4243 },
              { type: "browser", id: 4242 },
            ],
          }),
          detach: vi.fn().mockResolvedValue(undefined),
        }),
      };
      vi.mocked(chromium.launch).mockResolvedValue(browser as never);
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      vi.useFakeTimers();
      try {
        const managed = new ManagedBrowser(scraperConfig);
        await managed.get();

        const retiring = managed.retire(browser as never, "stuck");
        await vi.advanceTimersByTimeAsync(scraperConfig.pageTimeoutMs);
        await retiring;

        expect(kill).toHaveBeenCalledWith(4242, "SIGKILL");
      } finally {
        vi.useRealTimers();
        kill.mockRestore();
      }
    });

    it("gives up on a browser that will not close when its process ID is unknown", async () => {
      // The mocked browser has no CDP session, so no process ID was recorded.
      const browser = { ...buildBrowser(), close: vi.fn(() => new Promise(() => {})) };
      vi.mocked(chromium.launch).mockResolvedValue(browser as never);
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      vi.useFakeTimers();
      try {
        const managed = new ManagedBrowser(scraperConfig);
        await managed.get();

        const retiring = managed.retire(browser as never, "stuck");
        await vi.advanceTimersByTimeAsync(scraperConfig.pageTimeoutMs);
        await retiring;

        expect(kill).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        kill.mockRestore();
      }
    });

    it("leaves the current browser alone when an older one is retired", async () => {
      const launched = mockLaunches();
      const managed = new ManagedBrowser(scraperConfig);

      await managed.get();
      launched[0].isConnected.mockReturnValue(false);
      const current = await managed.get();
      await managed.retire(launched[0] as never, "late reset");

      expect(await managed.get()).toBe(current);
      expect(current.close).not.toHaveBeenCalled();
    });
  });

  describe("close", () => {
    it("closes the browser once when closed twice at the same time", async () => {
      const launched = mockLaunches();
      const managed = new ManagedBrowser(scraperConfig);

      await managed.get();
      await Promise.all([managed.close(), managed.close()]);

      expect(launched[0].close).toHaveBeenCalledTimes(1);
    });

    it("closes a browser whose launch was still in flight", async () => {
      const browser = buildBrowser();
      let finishLaunch: (value: unknown) => void = () => undefined;
      vi.mocked(chromium.launch).mockReturnValue(
        new Promise((resolve) => {
          finishLaunch = resolve;
        }) as never,
      );
      const managed = new ManagedBrowser(scraperConfig);

      const pending = managed.get();
      const closing = managed.close();
      finishLaunch(browser);
      await pending;
      await closing;

      expect(browser.close).toHaveBeenCalled();
    });
  });

  describe("launch", () => {
    beforeEach(() => {
      // Playwright's managed full build is installed, and nothing overrides it.
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "");
      vi.mocked(chromium.executablePath).mockReturnValue(process.execPath);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("launches the full build when the headless shell is not installed", async () => {
      // What `playwright install --no-shell` leaves behind.
      const browser = buildBrowser();
      vi.mocked(chromium.launch)
        .mockRejectedValueOnce(
          new Error(
            "browserType.launch: Executable doesn't exist at /ms-playwright/chromium_headless_shell-1228/chrome-headless-shell",
          ),
        )
        .mockResolvedValueOnce(browser as never);

      await expect(ManagedBrowser.launch()).resolves.toBe(browser);
      expect(chromium.launch).toHaveBeenLastCalledWith(
        expect.objectContaining({ channel: "chromium", headless: true }),
      );
    });

    it("does not retry a launch that failed for another reason", async () => {
      vi.mocked(chromium.launch).mockRejectedValue(
        new Error("browserType.launch: Target page, context or browser has been closed"),
      );

      await expect(ManagedBrowser.launch()).rejects.toThrow(/has been closed/);
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });

    it("does not swap a configured executable for the full build", async () => {
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "/opt/missing/chromium");
      vi.mocked(chromium.launch).mockRejectedValue(
        new Error(
          "browserType.launch: Executable doesn't exist at /opt/missing/chromium",
        ),
      );

      await expect(ManagedBrowser.launch()).rejects.toThrow(/doesn't exist/);
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });
  });
});
