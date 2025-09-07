// Copyright (c) 2025
import { describe, expect, it, vi } from "vitest";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import { BasePipeline } from "./BasePipeline";
import type { ProcessedContent } from "./types";

// Create a concrete subclass of BasePipeline for testing
class TestPipeline extends BasePipeline {
  canProcess(): boolean {
    return true;
  }

  async process(): Promise<ProcessedContent> {
    return { textContent: "", metadata: {}, links: [], errors: [], chunks: [] };
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
        ctx.metadata.step1 = true;
        await next();
      }),
    };

    const middleware2 = {
      process: vi.fn(async (ctx, next) => {
        ctx.metadata.step2 = true;
        await next();
      }),
    };

    const middleware3 = {
      process: vi.fn(async (ctx, next) => {
        ctx.metadata.step3 = true;
        await next();
      }),
    };

    const middlewareStack = [middleware1, middleware2, middleware3];

    await pipeline.testExecuteMiddlewareStack(middlewareStack, context);

    // Verify all middleware was called in order
    expect(middleware1.process).toHaveBeenCalledTimes(1);
    expect(middleware2.process).toHaveBeenCalledTimes(1);
    expect(middleware3.process).toHaveBeenCalledTimes(1);

    // Verify the context was updated by each middleware
    expect(context.metadata.step1).toBe(true);
    expect(context.metadata.step2).toBe(true);
    expect(context.metadata.step3).toBe(true);
  });

  it("executeMiddlewareStack catches errors and adds them to context", async () => {
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

    // Create middleware that throws an error
    const errorMiddleware = {
      process: vi.fn(async () => {
        throw new Error("Test error");
      }),
    };

    const middlewareStack = [errorMiddleware];

    await pipeline.testExecuteMiddlewareStack(middlewareStack, context);

    // Verify the error was caught and added to context
    expect(context.errors.length).toBe(1);
    expect(context.errors[0].message).toBe("Test error");
  });

  it("executeMiddlewareStack handles non-Error objects thrown", async () => {
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

    // Create middleware that throws a non-Error object
    const errorMiddleware = {
      process: vi.fn(async () => {
        throw "String error"; // Not an Error object
      }),
    };

    const middlewareStack = [errorMiddleware];

    await pipeline.testExecuteMiddlewareStack(middlewareStack, context);

    // Verify the error was caught, converted to Error, and added to context
    expect(context.errors.length).toBe(1);
    expect(context.errors[0].message).toBe("String error");
    expect(context.errors[0] instanceof Error).toBe(true);
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

  describe("cleanup", () => {
    it("should have default close() method that does nothing", async () => {
      const pipeline = new TestPipeline();

      // Should not throw any errors
      await expect(pipeline.close()).resolves.not.toThrow();
    });

    it("should be able to call close() multiple times", async () => {
      const pipeline = new TestPipeline();

      // Multiple calls should not throw
      await expect(pipeline.close()).resolves.not.toThrow();
      await expect(pipeline.close()).resolves.not.toThrow();
    });
  });
});
