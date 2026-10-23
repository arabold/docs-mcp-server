// Copyright (c) 2025
import { describe, expect, it, vi } from "vitest";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import { BasePipeline } from "./BasePipeline";
import type { PipelineResult } from "./types";

// Create a concrete subclass of BasePipeline for testing
class TestPipeline extends BasePipeline {
  canProcess(): boolean {
    return true;
  }

  async process(): Promise<PipelineResult> {
    return {
      textContent: "",
      links: [],
      errors: [],
      chunks: [],
    };
  }

  // Expose the protected method for testing
  async testExecuteMiddlewareStack(
    middleware: ContentProcessorMiddleware[],
    context: MiddlewareContext,
  ): Promise<void> {
    return this.executeMiddlewareStack(middleware, context);
  }
}

describe("BasePipeline", () => {
  it("executeMiddlewareStack calls middleware in order", async () => {
    const pipeline = new TestPipeline();
    const context: MiddlewareContext = {
      content: "test",
      source: "http://test",
      metadata: {},
      links: [],
      errors: [],
      // @ts-expect-error
      options: {},
    };

    // Create mock middleware
    const middleware1 = {
      process: vi.fn(async (ctx, next) => {
        ctx.title = "Step 1";
        await next();
      }),
    };

    const middleware2 = {
      process: vi.fn(async (ctx, next) => {
        ctx.title = "Step 2";
        await next();
      }),
    };

    const middleware3 = {
      process: vi.fn(async (ctx, next) => {
        ctx.title = "Step 3";
        await next();
      }),
    };

    const middlewareStack = [middleware1, middleware2, middleware3];

    await pipeline.testExecuteMiddlewareStack(middlewareStack, context);

    // Verify all middleware was called in order
    expect(middleware1.process).toHaveBeenCalledTimes(1);
    expect(middleware2.process).toHaveBeenCalledTimes(1);
    expect(middleware3.process).toHaveBeenCalledTimes(1);

    // Verify the context was updated by the middleware
    expect(context.title).toBe("Step 3");
  });

  it("executeMiddlewareStack catches thrown errors and adds them to context", async () => {
    const cases: Array<[label: string, thrown: unknown, message: string]> = [
      ["Error", new Error("Test error"), "Test error"],
      // A thrown non-Error is converted to an Error.
      ["non-Error", "String error", "String error"],
    ];

    for (const [label, thrown, message] of cases) {
      const pipeline = new TestPipeline();
      const context: MiddlewareContext = {
        content: "test",
        source: "http://test",
        metadata: {},
        links: [],
        errors: [],
        // @ts-expect-error
        options: {},
      };
      const errorMiddleware = {
        process: vi.fn(async () => {
          throw thrown;
        }),
      };

      await pipeline.testExecuteMiddlewareStack([errorMiddleware], context);

      expect.soft(context.errors, label).toHaveLength(1);
      expect.soft(context.errors[0], label).toBeInstanceOf(Error);
      expect.soft(context.errors[0]?.message, label).toBe(message);
    }
  });

  it("executeMiddlewareStack prevents calling next() multiple times", async () => {
    const pipeline = new TestPipeline();
    const context: MiddlewareContext = {
      content: "test",
      source: "http://test",
      metadata: {},
      links: [],
      errors: [],
      // @ts-expect-error
      options: {},
    };

    // Create middleware that calls next() twice
    const badMiddleware = {
      process: vi.fn(async (_ctx, next) => {
        await next();
        await next(); // This should throw
      }),
    };

    const middlewareStack = [badMiddleware];

    await pipeline.testExecuteMiddlewareStack(middlewareStack, context);

    // Verify the error was caught and added to context
    expect(context.errors.length).toBe(1);
    expect(context.errors[0].message).toBe("next() called multiple times");
  });
});
