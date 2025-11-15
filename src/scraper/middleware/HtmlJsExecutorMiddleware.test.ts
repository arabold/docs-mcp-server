import {
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockedObject,
  vi,
} from "vitest";
import { type ContentFetcher, FetchStatus, type RawContent } from "../fetcher/types";
import type { SandboxExecutionOptions, SandboxExecutionResult } from "../utils/sandbox";
import { executeJsInSandbox } from "../utils/sandbox";
import { HtmlJsExecutorMiddleware } from "./HtmlJsExecutorMiddleware";
import type { MiddlewareContext } from "./types";

// Mock the sandbox utility
vi.mock("../utils/sandbox");

describe("HtmlJsExecutorMiddleware", () => {
  let mockContext: MiddlewareContext;
  let mockNext: Mock;
  let mockSandboxResult: SandboxExecutionResult;
  let mockFetcher: MockedObject<ContentFetcher>;

  beforeEach(() => {
    vi.resetAllMocks();

    // Create a mock fetcher
    mockFetcher = vi.mocked<ContentFetcher>({
      canFetch: vi.fn(),
      fetch: vi.fn(),
    });

    mockContext = {
      source: "http://example.com",
      content: "", // Will be set in tests
      contentType: "text/html",
      links: [],
      errors: [],
      options: {
        url: "http://example.com",
        library: "test-lib",
        version: "1.0.0",
        signal: undefined,
      },
      fetcher: mockFetcher,
    };
    mockNext = vi.fn().mockResolvedValue(undefined);

    // Default mock result for the sandbox
    mockSandboxResult = {
      finalHtml: "<p>Default Final HTML</p>",
      errors: [],
    };
    (executeJsInSandbox as Mock).mockResolvedValue(mockSandboxResult);
  });

  it("should call executeJsInSandbox for HTML content", async () => {
    mockContext.content = "<p>Initial</p><script></script>";
    const middleware = new HtmlJsExecutorMiddleware();

    await middleware.process(mockContext, mockNext);

    expect(executeJsInSandbox).toHaveBeenCalledOnce();
    // Verify fetchScriptContent is passed as a function
    expect(executeJsInSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        html: "<p>Initial</p><script></script>",
        url: "http://example.com",
        fetchScriptContent: expect.any(Function),
      }),
    );
  });

  it("should update context.content with finalHtml from sandbox result", async () => {
    mockContext.content = "<p>Initial</p>";
    mockSandboxResult.finalHtml = "<p>Modified HTML</p>";
    (executeJsInSandbox as Mock).mockResolvedValue(mockSandboxResult);
    const middleware = new HtmlJsExecutorMiddleware();

    await middleware.process(mockContext, mockNext);

    expect(mockContext.content).toBe("<p>Modified HTML</p>");
  });

  it("should add sandbox errors to context.errors", async () => {
    mockContext.content = "<p>Initial</p>";
    const error1 = new Error("Script error 1");
    const error2 = new Error("Script error 2");
    mockSandboxResult.errors = [error1, error2];
    (executeJsInSandbox as Mock).mockResolvedValue(mockSandboxResult);
    const middleware = new HtmlJsExecutorMiddleware();

    await middleware.process(mockContext, mockNext);

    expect(mockContext.errors).toHaveLength(2);
    expect(mockContext.errors).toContain(error1);
    expect(mockContext.errors).toContain(error2);
  });

  it("should call next after successful processing", async () => {
    mockContext.content = "<p>Initial</p>";
    const middleware = new HtmlJsExecutorMiddleware();

    await middleware.process(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
  });

  it("should handle critical errors during sandbox execution call", async () => {
    mockContext.content = "<p>Initial</p>";
    const criticalError = new Error("Sandbox function failed");
    (executeJsInSandbox as Mock).mockRejectedValue(criticalError);
    const middleware = new HtmlJsExecutorMiddleware();

    await middleware.process(mockContext, mockNext);

    expect(mockContext.errors).toHaveLength(1);
    // Corrected expectation to match the actual wrapped error message format
    expect(mockContext.errors[0].message).toBe(
      "HtmlJsExecutorMiddleware failed for http://example.com: Sandbox function failed",
    );
    expect(mockNext).not.toHaveBeenCalled(); // Should not proceed if middleware itself fails
  });

  // --- Tests for fetchScriptContent callback logic ---

  it("fetchScriptContent callback should use context.fetcher to fetch script", async () => {
    mockContext.content = "<p>Initial</p><script src='ext.js'></script>";
    const middleware = new HtmlJsExecutorMiddleware();
    const mockScriptContent = "console.log('fetched');";
    const mockRawContent: RawContent = {
      content: Buffer.from(mockScriptContent),
      mimeType: "application/javascript",
      source: "http://example.com/ext.js",
      status: FetchStatus.SUCCESS,
    };
    mockFetcher.fetch.mockResolvedValue(mockRawContent);

    await middleware.process(mockContext, mockNext);

    // Get the options passed to the sandbox mock
    const sandboxOptions = (executeJsInSandbox as Mock).mock
      .calls[0][0] as SandboxExecutionOptions;
    expect(sandboxOptions.fetchScriptContent).toBeDefined();

    // Invoke the callback to test its behavior
    const fetchedContent = await sandboxOptions.fetchScriptContent!(
      "http://example.com/ext.js",
    );

    expect(mockFetcher.fetch).toHaveBeenCalledWith("http://example.com/ext.js", {
      signal: undefined,
      followRedirects: true,
    });
    expect(fetchedContent).toBe(mockScriptContent);
    expect(mockContext.errors).toHaveLength(0); // No errors expected during fetch
  });

  it("fetchScriptContent callback should handle fetcher errors", async () => {
    mockContext.content = "<p>Initial</p><script src='ext.js'></script>";
    const middleware = new HtmlJsExecutorMiddleware();
    const fetchError = new Error("Network Failed");
    mockFetcher.fetch.mockRejectedValue(fetchError);

    await middleware.process(mockContext, mockNext);

    const sandboxOptions = (executeJsInSandbox as Mock).mock
      .calls[0][0] as SandboxExecutionOptions;
    const fetchedContent = await sandboxOptions.fetchScriptContent!(
      "http://example.com/ext.js",
    );

    expect(mockFetcher.fetch).toHaveBeenCalledWith("http://example.com/ext.js", {
      signal: undefined,
      followRedirects: true,
    });
    expect(fetchedContent).toBeNull();
    expect(mockContext.errors).toHaveLength(1);
    expect(mockContext.errors[0].message).toContain(
      "Failed to fetch external script http://example.com/ext.js: Network Failed",
    );
    expect(mockContext.errors[0].cause).toBe(fetchError);
  });

  it("fetchScriptContent callback should handle non-JS MIME types", async () => {
    mockContext.content = "<p>Initial</p><script src='style.css'></script>";
    const middleware = new HtmlJsExecutorMiddleware();
    const mockRawContent: RawContent = {
      content: "body { color: red; }",
      mimeType: "text/css", // Incorrect MIME type
      source: "http://example.com/style.css",
      status: FetchStatus.SUCCESS,
    };
    mockFetcher.fetch.mockResolvedValue(mockRawContent);

    await middleware.process(mockContext, mockNext);

    const sandboxOptions = (executeJsInSandbox as Mock).mock
      .calls[0][0] as SandboxExecutionOptions;
    const fetchedContent = await sandboxOptions.fetchScriptContent!(
      "http://example.com/style.css",
    );

    expect(mockFetcher.fetch).toHaveBeenCalledWith("http://example.com/style.css", {
      signal: undefined,
      followRedirects: true,
    });
    expect(fetchedContent).toBeNull();
    expect(mockContext.errors).toHaveLength(1);
    expect(mockContext.errors[0].message).toContain(
      "Skipping execution of external script http://example.com/style.css due to unexpected MIME type: text/css",
    );
  });

  it("fetchScriptContent callback should handle missing fetcher in context", async () => {
    mockContext.content = "<p>Initial</p><script src='ext.js'></script>";
    mockContext.fetcher = undefined; // Remove fetcher for this test
    const middleware = new HtmlJsExecutorMiddleware();

    await middleware.process(mockContext, mockNext);

    const sandboxOptions = (executeJsInSandbox as Mock).mock
      .calls[0][0] as SandboxExecutionOptions;
    const fetchedContent = await sandboxOptions.fetchScriptContent!(
      "http://example.com/ext.js",
    );

    expect(mockFetcher.fetch).not.toHaveBeenCalled(); // Fetcher should not be called
    expect(fetchedContent).toBeNull();
    expect(mockContext.errors).toHaveLength(0); // Only logs a warning, doesn't add error
    // We can't easily verify logger.warn was called without mocking it again here,
    // but the null return and lack of fetch call imply the check worked.
  });
});
