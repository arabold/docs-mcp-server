/** Tests for how runCli reports a command that fails */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ModelConfigurationError } from "../store/embeddings/EmbeddingFactory";
import { logger } from "../utils/logger";
import { CliUsageError, createCli } from "./index";
import { runCli } from "./main";

vi.mock("./index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./index")>()),
  createCli: vi.fn(),
}));

describe("runCli", () => {
  let exitSpy: MockInstance<typeof process.exit>;
  let sigintListeners = process.listeners("SIGINT");

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    sigintListeners = process.listeners("SIGINT");
  });

  afterEach(() => {
    exitSpy.mockRestore();
    // runCli installs its own SIGINT handler; leave the worker's handlers as they were
    for (const listener of process.listeners("SIGINT")) {
      if (!sigintListeners.includes(listener)) {
        process.removeListener("SIGINT", listener);
      }
    }
  });

  function failWith(error: Error): void {
    vi.mocked(createCli).mockReturnValue({
      parse: () => Promise.reject(error),
    } as unknown as ReturnType<typeof createCli>);
  }

  it("keeps the stack of an embedding configuration error for debug output", async () => {
    const error = new ModelConfigurationError(
      "Failed to connect to openai embedding service",
    );
    failWith(error);

    await runCli();

    expect(logger.error).toHaveBeenCalledWith(error.message);
    expect(logger.debug).toHaveBeenCalledWith(error.stack);
  });

  it("adds nothing to a usage error, whose help and reason are already printed", async () => {
    failWith(new CliUsageError("Unknown argument: unknown-flag"));

    await runCli();

    expect(logger.error).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
