import { describe, expect, it } from "vitest";
import { FetchStatus, type RawContent } from "../fetcher";
import { ScrapeMode } from "../types";
import { type PipelineConfiguration, PipelineFactory } from "./PipelineFactory";

describe("PipelineFactory Integration", () => {
  describe("configuration propagation", () => {
    it("should propagate custom chunk sizes through process method", async () => {
      // Create pipelines with custom configuration
      const config: PipelineConfiguration = {
        chunkSizes: {
          preferred: 100, // Very small for testing
          max: 200,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);

      // Create content that would definitely exceed the custom chunk size
      const longContent =
        "This is a test sentence that is long enough to be split.\n".repeat(10); // ~570 characters with newlines

      // Test with TextPipeline (last pipeline, universal fallback)
      const textPipeline = pipelines[4]; // TextPipeline

      // Create mock RawContent for the process method
      const rawContent: RawContent = {
        source: "test.txt",
        content: longContent,
        mimeType: "text/plain",
        status: FetchStatus.SUCCESS,
      };

      const scraperOptions = {
        url: "test.txt",
        library: "test",
        version: "1.0.0",
        scrapeMode: ScrapeMode.Fetch,
        ignoreErrors: false,
        maxConcurrency: 1,
      };

      const processed = await textPipeline.process(rawContent, scraperOptions);

      // Verify that chunks are smaller due to custom configuration
      // With 570 characters and 100 char preferred size, should be multiple chunks
      expect(processed.chunks?.length).toBeGreaterThan(1); // Should be split into multiple chunks
      processed.chunks?.forEach((chunk) => {
        expect(chunk.content.length).toBeGreaterThan(0);
        // Should be much smaller than default 1500
        expect(chunk.content.length).toBeLessThan(300);
      });
    });

    it("should use default chunk sizes when no configuration provided", async () => {
      const pipelines = PipelineFactory.createStandardPipelines();

      // Create moderate content that would fit in default chunks
      const moderateContent = "This is a test sentence. ".repeat(10); // ~250 characters

      // Test with TextPipeline
      const textPipeline = pipelines[4];

      const rawContent: RawContent = {
        source: "test.txt",
        content: moderateContent,
        mimeType: "text/plain",
        status: FetchStatus.SUCCESS,
      };

      const scraperOptions = {
        url: "test.txt",
        library: "test",
        version: "1.0.0",
        scrapeMode: ScrapeMode.Fetch,
        ignoreErrors: false,
        maxConcurrency: 1,
      };

      const processed = await textPipeline.process(rawContent, scraperOptions);

      // With default chunk size (1500), this should fit in one chunk
      expect(processed.chunks?.length).toBe(1);
      expect(processed.chunks?.[0].content?.length).toBeLessThan(300);
    });

    it("should handle different pipeline types with custom configuration", async () => {
      const config: PipelineConfiguration = {
        chunkSizes: {
          preferred: 300,
          max: 600,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);

      // Test each pipeline
      const testContent = "This is a test content that might be split. ".repeat(10); // ~450 characters

      for (const pipeline of pipelines) {
        const rawContent: RawContent = {
          source: "test.txt",
          content: testContent,
          mimeType: "text/plain",
          status: FetchStatus.SUCCESS,
        };

        const scraperOptions = {
          url: "test.txt",
          library: "test",
          version: "1.0.0",
          scrapeMode: ScrapeMode.Fetch,
          ignoreErrors: false,
          maxConcurrency: 1,
        };

        const processed = await pipeline.process(rawContent, scraperOptions);
        expect(processed.chunks?.length).toBeGreaterThanOrEqual(1);

        // Verify each chunk respects the configuration
        processed.chunks?.forEach((chunk) => {
          expect(chunk.content.length).toBeGreaterThan(0);
          // Allow some flexibility for splitting logic, but ensure it's not wildly large
          expect(chunk.content.length).toBeLessThan(800);
        });
      }
    });
  });

  describe("content type processing behavior", () => {
    const baseOptions = {
      url: "test",
      library: "test",
      version: "1.0.0",
      scrapeMode: ScrapeMode.Fetch,
      ignoreErrors: false,
      maxConcurrency: 1,
    };

    // Helper function to find and process content with the first matching pipeline
    async function processContent(content: string, mimeType: string) {
      // Use small chunk sizes to force splitting for test content
      const pipelines = PipelineFactory.createStandardPipelines({
        chunkSizes: { preferred: 80, max: 150 },
      });

      const rawContent: RawContent = {
        source: "test",
        content,
        mimeType,
        status: FetchStatus.SUCCESS,
      };

      // Find the first pipeline that can process this content
      const contentBuffer = Buffer.from(content);
      for (const pipeline of pipelines) {
        if (pipeline.canProcess(mimeType, contentBuffer)) {
          return await pipeline.process(rawContent, baseOptions);
        }
      }

      throw new Error(`No pipeline found for content type: ${mimeType}`);
    }

    it("should process HTML content with heading hierarchy and markdown conversion", async () => {
      const htmlContent = `
        <h1>Main Title</h1>
        <p>Some paragraph content here.</p>
        <h2>Subsection</h2>
        <p>More content in subsection.</p>
        <table>
          <tr><th>Header</th></tr>
          <tr><td>Data</td></tr>
        </table>
      `;

      const result = await processContent(htmlContent, "text/html");

      // HTML should be converted to markdown and create chunks
      expect(result.chunks?.length).toBeGreaterThanOrEqual(1);

      // Should have chunks with heading-based hierarchy
      const headingChunks = result.chunks?.filter(
        (chunk) => chunk.types.includes("heading") || chunk.section.path.length > 0,
      );
      expect(headingChunks?.length).toBeGreaterThan(0);

      // Should convert table to markdown format
      const tableChunks = result.chunks?.filter((chunk) => chunk.types.includes("table"));
      expect(tableChunks?.[0].content).toMatch(/\|.*\|/); // Markdown table format

      // Verify no single chunk exceeds max size (150 with buffer)
      result.chunks?.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(200);
      });
    });

    it("should process JavaScript/TypeScript with semantic code boundaries", async () => {
      const jsContent = `
        function greet(name) {
          return "Hello, " + name;
        }
        
        class Calculator {
          add(a, b) {
            return a + b;
          }
          
          multiply(a, b) {
            return a * b;
          }
        }
        
        const result = greet("World");
        console.log(result);
      `;

      const result = await processContent(jsContent, "application/javascript");

      // Should split along semantic boundaries (functions, classes)
      expect(result.chunks?.length).toBeGreaterThan(1);

      // Should preserve code structure and formatting
      result.chunks?.forEach((chunk) => {
        expect(chunk.types).toContain("code");
        // All chunks should have content (including whitespace for perfect reconstruction)
        expect(chunk.content.length).toBeGreaterThan(0);
      });

      // Should maintain perfect reconstruction
      const reconstructed = result.chunks?.map((chunk) => chunk.content).join("");
      expect(reconstructed?.trim()).toBe(jsContent.trim());
      expect(reconstructed).toContain("add(a, b)");
      expect(reconstructed).toContain("multiply(a, b)");
      expect(reconstructed).toContain('greet("World")');
      expect(reconstructed).toContain("console.log(result)");
    });

    it("should process JSON with structure-aware organization", async () => {
      const jsonContent = JSON.stringify(
        {
          name: "Test Library",
          version: "1.0.0",
          dependencies: {
            lodash: "^4.17.21",
            express: "^4.18.0",
          },
          scripts: {
            build: "webpack --mode production",
            test: "jest",
            start: "node index.js",
          },
          config: {
            database: {
              host: "localhost",
              port: 5432,
              name: "testdb",
            },
          },
        },
        null,
        2,
      );

      const result = await processContent(jsonContent, "application/json");

      // Should handle JSON structure appropriately
      expect(result.chunks?.length).toBeGreaterThanOrEqual(1);

      // Should preserve JSON formatting and structure
      result.chunks?.forEach((chunk) => {
        expect(chunk.content.trim()).not.toBe("");
        // JSON chunks should be valid when reconstructed
        const reconstructed = result.chunks?.map((c) => c.content).join("");
        expect(() => JSON.parse(reconstructed || "")).not.toThrow();
      });
    });

    it("should process Markdown with content type distinction and hierarchy", async () => {
      const markdownContent = `
# Main Document

This is the introduction paragraph.

## Code Section

Here's some code:

\`\`\`javascript
function example() {
  return "Hello World";
}
\`\`\`

## Data Section

| Name | Value |
|------|-------|
| Item1 | 100   |
| Item2 | 200   |

### Subsection

More detailed content here.
      `;

      const result = await processContent(markdownContent, "text/markdown");

      // Should create chunks (quantity depends on greedy merging logic)
      expect(result.chunks?.length).toBeGreaterThanOrEqual(1);

      // Should distinguish between content types
      const contentTypes = new Set(result.chunks?.flatMap((chunk) => chunk.types));
      expect(contentTypes.size).toBeGreaterThan(1); // Should have multiple content types

      // Should create hierarchical paths based on headings
      const hierarchicalChunks = result.chunks?.filter(
        (chunk) => chunk.section.path.length > 0,
      );
      expect(hierarchicalChunks?.length).toBeGreaterThan(0);

      // Should preserve markdown structure
      const codeChunks = result.chunks?.filter((chunk) => chunk.types.includes("code"));
      const tableChunks = result.chunks?.filter((chunk) => chunk.types.includes("table"));

      expect(codeChunks?.length).toBeGreaterThan(0);
      expect(tableChunks?.length).toBeGreaterThan(0);

      // Verify no single chunk exceeds max size (150 with buffer)
      result.chunks?.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(200);
      });
    });

    it("should process plain text with simple structure and no hierarchy", async () => {
      const textContent = `
This is a plain text document.
It has multiple lines and paragraphs.

This is another paragraph with some content.
The text should be split appropriately but without any complex structure.

Final paragraph here.
      `;

      const result = await processContent(textContent, "text/plain");

      // Should split into chunks but maintain simplicity
      expect(result.chunks?.length).toBeGreaterThanOrEqual(1);

      // All chunks should be text type with no hierarchy
      result.chunks?.forEach((chunk) => {
        expect(chunk.types).toEqual(["text"]);
        expect(chunk.section.path).toEqual([]); // No hierarchical structure
        expect(chunk.section.level).toBe(0);
      });

      // Should preserve content exactly
      const reconstructed = result.chunks?.map((chunk) => chunk.content).join("");
      expect(reconstructed?.trim()).toBe(textContent.trim());
    });
  });

  describe("configuration behavior validation", () => {
    const baseOptions = {
      url: "test",
      library: "test",
      version: "1.0.0",
      scrapeMode: ScrapeMode.Fetch,
      ignoreErrors: false,
      maxConcurrency: 1,
    };

    it("should respect semantic boundaries even with small chunk sizes", async () => {
      const config: PipelineConfiguration = {
        chunkSizes: {
          preferred: 50, // Very small
          max: 100,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);

      const markdownContent = `
# Main Title

## Section One
Content for section one that is longer than the chunk size limit.

## Section Two  
More content for section two that also exceeds the small limit.
      `;

      const rawContent: RawContent = {
        source: "test.md",
        content: markdownContent,
        mimeType: "text/markdown",
        status: FetchStatus.SUCCESS,
      };

      // Find markdown pipeline
      const contentBuffer = Buffer.from(markdownContent);
      const markdownPipeline = pipelines.find((p) =>
        p.canProcess(rawContent.mimeType, contentBuffer),
      );
      expect(markdownPipeline).toBeDefined();

      const result = await markdownPipeline!.process(rawContent, baseOptions);

      // Even with small chunk size, should maintain semantic structure
      const headingChunks = result.chunks?.filter((chunk) =>
        chunk.types.includes("heading"),
      );
      expect(headingChunks?.length).toBeGreaterThan(0);

      // Should still create proper hierarchy despite size constraints
      const hierarchicalChunks = result.chunks?.filter(
        (chunk) => chunk.section.path.length > 0,
      );
      expect(hierarchicalChunks?.length).toBeGreaterThan(0);
    });

    it("should preserve logical units in code even with large chunk sizes", async () => {
      const config: PipelineConfiguration = {
        chunkSizes: {
          preferred: 2000, // Large
          max: 4000,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);

      const codeContent = `
function small() { return 1; }

function another() { return 2; }

class MyClass {
  method1() { return "a"; }
  method2() { return "b"; }
}
      `;

      const rawContent: RawContent = {
        source: "test.js",
        content: codeContent,
        mimeType: "application/javascript",
        status: FetchStatus.SUCCESS,
      };

      const contentBuffer = Buffer.from(codeContent);
      const codePipeline = pipelines.find((p) =>
        p.canProcess(rawContent.mimeType, contentBuffer),
      );
      expect(codePipeline).toBeDefined();

      const result = await codePipeline!.process(rawContent, baseOptions);

      // Even with large chunk size allowing everything in one chunk,
      // should still respect logical code boundaries
      expect(result.chunks?.length).toBeGreaterThanOrEqual(1);

      // Should maintain code structure
      result.chunks?.forEach((chunk) => {
        expect(chunk.types).toContain("code");
        expect(chunk.content.trim()).not.toBe("");
      });
    });

    it("should handle size constraints appropriately across content types", async () => {
      const config: PipelineConfiguration = {
        chunkSizes: {
          preferred: 100,
          max: 200,
        },
      };

      const pipelines = PipelineFactory.createStandardPipelines(config);

      const testCases = [
        { content: "Short text content.", mimeType: "text/plain" },
        {
          content: `{"key": "value", "nested": {"data": "content"}}`,
          mimeType: "application/json",
        },
        {
          content: "function test() { return true; }",
          mimeType: "application/javascript",
        },
      ];

      for (const testCase of testCases) {
        const rawContent: RawContent = {
          source: "test",
          content: testCase.content,
          mimeType: testCase.mimeType,
          status: FetchStatus.SUCCESS,
        };

        const contentBuffer = Buffer.from(testCase.content);
        const pipeline = pipelines.find((p) =>
          p.canProcess(rawContent.mimeType, contentBuffer),
        );
        expect(pipeline).toBeDefined();

        const result = await pipeline!.process(rawContent, baseOptions);

        // All should respect the size constraints
        result.chunks?.forEach((chunk) => {
          expect(chunk.content.length).toBeLessThanOrEqual(250); // Small buffer for edge cases
        });
      }
    });
  });

  describe("fallback and edge case behavior", () => {
    const baseOptions = {
      url: "test",
      library: "test",
      version: "1.0.0",
      scrapeMode: ScrapeMode.Fetch,
      ignoreErrors: false,
      maxConcurrency: 1,
    };

    it("should reject unknown MIME types - no pipeline should process them", async () => {
      const pipelines = PipelineFactory.createStandardPipelines();

      const unknownContent = {
        source: "test.unknown",
        content: "Some content in an unknown format.",
        mimeType: "application/unknown-format",
      };

      // No pipeline should accept unknown MIME types
      const contentBuffer = Buffer.from(unknownContent.content);
      const acceptingPipeline = pipelines.find((p) =>
        p.canProcess(unknownContent.mimeType, contentBuffer),
      );
      expect(acceptingPipeline).toBeUndefined();

      // Verify that each pipeline explicitly rejects it
      pipelines.forEach((pipeline) => {
        expect(pipeline.canProcess(unknownContent.mimeType, contentBuffer)).toBe(false);
      });
    });

    it("should handle invalid JSON as text content", async () => {
      const pipelines = PipelineFactory.createStandardPipelines();

      const invalidJsonContent: RawContent = {
        source: "test.json",
        content: '{"invalid": json, missing quotes}',
        mimeType: "application/json",
        status: FetchStatus.SUCCESS,
      };

      const contentBuffer = Buffer.from(invalidJsonContent.content);
      const jsonPipeline = pipelines.find((p) =>
        p.canProcess(invalidJsonContent.mimeType, contentBuffer),
      );
      expect(jsonPipeline).toBeDefined();

      const result = await jsonPipeline!.process(invalidJsonContent, baseOptions);

      // Should handle gracefully and process as text-like content
      expect(result.chunks?.length).toBeGreaterThanOrEqual(1);
      // expect(result.metadata.isValidJson).toBe(false);
    });

    it("should maintain content integrity across different processing paths", async () => {
      const pipelines = PipelineFactory.createStandardPipelines();

      const testCases = [
        { content: "<p>HTML content</p>", mimeType: "text/html" },
        { content: "# Markdown content", mimeType: "text/markdown" },
        { content: "function test() {}", mimeType: "application/javascript" },
        { content: "Plain text content", mimeType: "text/plain" },
      ];

      for (const testCase of testCases) {
        const rawContent: RawContent = {
          source: "test",
          content: testCase.content,
          mimeType: testCase.mimeType,
          status: FetchStatus.SUCCESS,
        };

        const contentBuffer = Buffer.from(testCase.content);
        const pipeline = pipelines.find((p) =>
          p.canProcess(rawContent.mimeType, contentBuffer),
        );
        expect(pipeline).toBeDefined();

        const result = await pipeline!.process(rawContent, baseOptions);

        // Content should be preserved (allowing for format conversion)
        expect(result.textContent?.trim()).not.toBe("");
        expect(result.chunks?.length).toBeGreaterThan(0);

        // Should be able to reconstruct meaningful content
        const reconstructed = result.chunks
          ?.map((chunk) => chunk.content)
          .join("")
          .trim();
        expect(reconstructed).not.toBe("");
      }
    });
  });
});
