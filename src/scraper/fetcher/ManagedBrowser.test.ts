import { type Browser, chromium } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../utils/config";
import { ManagedBrowser } from "./ManagedBrowser";
import { startObscura } from "./obscura";

vi.mock("playwright", () => ({ chromium: { connectOverCDP: vi.fn() } }));
vi.mock("./obscura", () => ({ startObscura: vi.fn() }));

const scraperConfig = DEFAULT_CONFIG.scraper;

function mockServer() {
  return {
    endpoint: "ws://127.0.0.1:9222/devtools/browser",
    token: "test-token",
    isRunning: vi.fn(() => true),
    close: vi.fn(async () => {}),
  };
}

function mockBrowser() {
  const browser = {
    close: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  };
  return { browser: browser as unknown as Browser, close: browser.close };
}

describe("ManagedBrowser", () => {
  const start = vi.mocked(startObscura);
  const connect = vi.mocked(chromium.connectOverCDP);
  let managed: ManagedBrowser;

  beforeEach(() => {
    vi.resetAllMocks();
    managed = new ManagedBrowser(scraperConfig);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await managed.close();
  });

  it("shares a process between concurrent connections", async () => {
    // arrange
    const server = mockServer();
    const { browser: first } = mockBrowser();
    const { browser: second } = mockBrowser();
    start.mockResolvedValue(server);
    connect.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    // act
    const browsers = await Promise.all([managed.get(), managed.get()]);

    // assert
    expect(browsers).toEqual([first, second]);
    expect(start).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledWith(
      server.endpoint,
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    );
  });

  it("releases one connection while leaving the others available", async () => {
    // arrange
    const server = mockServer();
    const first = mockBrowser();
    const second = mockBrowser();
    start.mockResolvedValue(server);
    connect.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    const [released, active] = await Promise.all([managed.get(), managed.get()]);

    // act
    await managed.release(released);

    // assert
    expect(first.close).toHaveBeenCalledOnce();
    expect(managed.isCurrent(active)).toBe(true);
    expect(server.close).not.toHaveBeenCalled();
  });

  it("starts a replacement after the process exits", async () => {
    // arrange
    const server = mockServer();
    const replacement = mockServer();
    start.mockResolvedValueOnce(server).mockResolvedValueOnce(replacement);
    const first = mockBrowser();
    const second = mockBrowser();
    connect.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    const crashed = await managed.get();
    server.isRunning.mockReturnValue(false);

    // act
    const recovered = await managed.get();

    // assert
    expect(managed.isCurrent(crashed)).toBe(false);
    expect(managed.isCurrent(recovered)).toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("retires the shared process when a connection cannot close", async () => {
    // arrange
    vi.useFakeTimers();
    const server = mockServer();
    const { browser, close } = mockBrowser();
    close.mockImplementation(() => new Promise<void>(() => {}));
    start.mockResolvedValue(server);
    connect.mockResolvedValue(browser);
    const connection = await managed.get();

    // act
    const closing = managed.release(connection);
    await vi.advanceTimersByTimeAsync(scraperConfig.pageTimeoutMs);
    await closing;

    // assert
    expect(server.close).toHaveBeenCalledOnce();
    expect(managed.isCurrent(connection)).toBe(false);
  });
});
