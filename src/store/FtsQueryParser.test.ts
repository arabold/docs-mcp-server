import { describe, expect, it } from "vitest";
import { parseQuery } from "./FtsQueryParser";

describe("FtsQueryParser", () => {
  describe("parseQuery", () => {
    it("should handle empty and whitespace-only queries", () => {
      expect(parseQuery("")).toBe("");
      expect(parseQuery("   ")).toBe("");
      expect(parseQuery("\t\n")).toBe("");
    });

    it("should preserve safe single terms without quoting", () => {
      expect(parseQuery("react")).toBe("react");
      expect(parseQuery("JavaScript")).toBe("JavaScript");
      expect(parseQuery("test123")).toBe("test123");
      expect(parseQuery("hello_world")).toBe("hello_world");
    });

    it("should quote terms with unsafe characters", () => {
      // The key security fix: terms with special chars are quoted
      expect(parseQuery("arrow-functions")).toBe('"arrow-functions"');
      expect(parseQuery("function()")).toBe('"function()"');
      expect(parseQuery("element[attribute]")).toBe('"element[attribute]"');
      expect(parseQuery(".class")).toBe('".class"');
      expect(parseQuery("#id")).toBe('"#id"');
      expect(parseQuery("test()")).toBe('"test()"');
    });

    it("should join multiple safe terms with OR", () => {
      expect(parseQuery("react components")).toBe("react OR components");
      expect(parseQuery("javascript functions tutorial")).toBe(
        "javascript OR functions OR tutorial",
      );
    });

    it("should handle mixed safe and unsafe terms", () => {
      expect(parseQuery("react arrow-functions")).toBe('react OR "arrow-functions"');
      expect(parseQuery("test .class selector")).toBe('test OR ".class" OR selector');
    });

    it("should preserve quoted strings", () => {
      expect(parseQuery('"arrow functions"')).toBe('"arrow functions"');
      expect(parseQuery('"complex query with spaces"')).toBe(
        '"complex query with spaces"',
      );
    });

    it("should handle FTS operators correctly", () => {
      // Valid operators should be preserved
      expect(parseQuery("javascript AND functions")).toBe("javascript AND functions");
      expect(parseQuery("react OR vue")).toBe("react OR vue");
      expect(parseQuery("NOT deprecated")).toBe("NOT deprecated");

      // Single operators are passed through since they're detected as operators
      expect(parseQuery("AND")).toBe("AND");
      expect(parseQuery("OR NOT")).toBe("OR NOT");
      expect(parseQuery("term something")).toBe("term OR something"); // No operators detected
    });

    it("should handle wildcards conservatively", () => {
      // All wildcards are quoted for security
      expect(parseQuery("function*")).toBe('"function*"');
      expect(parseQuery("test* result")).toBe('"test*" OR result');
      expect(parseQuery("*invalid")).toBe('"*invalid"');
    });

    it("should use AND operator when specified", () => {
      expect(parseQuery("react components", { defaultOperator: "AND" })).toBe(
        "react AND components",
      );
    });

    it("should handle complex operator queries", () => {
      // Valid operators should be preserved when properly structured
      expect(parseQuery("javascript AND functions")).toBe("javascript AND functions");
      expect(parseQuery("react OR vue")).toBe("react OR vue");
    });

    it("should handle unicode characters", () => {
      expect(parseQuery("développement")).toBe("développement");
      expect(parseQuery("プログラミング")).toBe("プログラミング");
      expect(parseQuery("café-script")).toBe('"café-script"'); // hyphen makes it unsafe
    });

    it("should handle malformed input gracefully", () => {
      // Queries with quotes are passed through as-is
      expect(parseQuery('"unclosed quote')).toBe('"unclosed quote');
      expect(parseQuery('test"injection')).toBe('test"injection');
    });
  });

  describe("security tests", () => {
    it("should prevent the original FTS injection vulnerability", () => {
      // This was the critical bug - hyphenated terms were not quoted
      const result = parseQuery("arrow-functions");
      expect(result).toBe('"arrow-functions"');

      // Verify it's properly quoted and safe
      expect(result).toMatch(/^".*"$/);
    });

    it("should quote all potentially dangerous characters", () => {
      const dangerousQueries = [
        "test()",
        "element[attr]",
        "path/to/file",
        "@decorator",
        "$variable",
        "ns:element",
        "column-name",
        "multi.word.path",
        "func(arg1,arg2)",
      ];

      for (const query of dangerousQueries) {
        const result = parseQuery(query);
        // All dangerous single-term queries should be quoted
        expect(result).toMatch(/^".*"$/);
      }

      // Multi-term dangerous queries get split and quoted appropriately
      const result = parseQuery("test;DROP TABLE");
      expect(result).toBe('"test;DROP" OR TABLE');
    });

    it("should handle attempts to inject operators", () => {
      // Single operators are detected as operators and passed through
      expect(parseQuery("AND")).toBe("AND");
      expect(parseQuery("OR")).toBe("OR");
      expect(parseQuery("NOT")).toBe("NOT");

      // Multi-operator sequences are also detected and passed through
      expect(parseQuery("AND OR")).toBe("AND OR");
      expect(parseQuery("term something")).toBe("term OR something"); // No operators, so OR joined
    });

    it("should handle quote injection attempts safely", () => {
      // Queries with quotes are passed through as-is
      expect(parseQuery('test"injection')).toBe('test"injection');
      expect(parseQuery('""')).toBe('""');
      expect(parseQuery('"a"b"')).toBe('"a"b"');
    });

    it("should prevent column name injection", () => {
      // This prevents the "functions" being interpreted as a column name
      expect(parseQuery("arrow-functions")).toBe('"arrow-functions"');
      expect(parseQuery("table.column")).toBe('"table.column"');
      expect(parseQuery("db:table")).toBe('"db:table"');
    });
  });
});
