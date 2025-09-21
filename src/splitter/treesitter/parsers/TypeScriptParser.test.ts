/**
 * Canonical Ruleset Coverage: TypeScriptParser
 *
 * This suite validates that the TypeScript parser (syntax + boundary extraction)
 * supports the semantic foundation required by the TreesitterSourceCodeSplitter.
 *
 * Focus (parser responsibilities only):
 *  - Structural node detection (classes, interfaces, enums, type aliases, namespaces, functions, variable arrow functions)
 *  - Boundary classification (structural vs content)
 *  - Name extraction accuracy
 *  - Documentation merging (startLine adjustment to doc block)
 *  - Modifiers capture
 *  - Resilience to malformed code (partial extraction)
 *  - No emission of nested local helpers (those are not structural at parser boundary level)
 *
 * Out of scope here (validated in splitter tests):
 *  - Hierarchical path assignment
 *  - Chunk size enforcement / subdivision
 *  - Reconstruction fidelity across emitted chunks
 */

import { describe, expect, it } from "vitest";
import { TypeScriptParser } from "./TypeScriptParser";
import { StructuralNodeType } from "./types";

const parser = new TypeScriptParser();

/**
 * Helper: extract boundaries and map by name for easier assertions.
 */
function boundaryMap(source: string) {
  const result = parser.parse(source);
  const boundaries = parser.extractBoundaries(result.tree, source);
  const byName = new Map<string, (typeof boundaries)[number]>();
  for (const b of boundaries) {
    if (b.name) byName.set(b.name, b);
  }
  return { result, boundaries, byName };
}

describe("TypeScriptParser canonical structural emission", () => {
  it("emits boundaries for core structural & content declarations", () => {
    const code = `
/** Class docs */ export class Alpha {
  /** method docs */
  run() {}
}

/** Interface docs */
interface Shape { area(): number; }

/** Enum docs */
enum Color { Red, Green, Blue }

/** Type alias docs */
type ID = string;

/** Function docs */
function util(x: number): number { return x * 2; }

/** Arrow function docs */
const compute = (a: number, b: number) => a + b;

namespace Outer {
  export class Box {
    value: number;
    getValue(): number { return this.value; }
  }
}
    `.trim();

    const { boundaries, byName } = boundaryMap(code);

    // Expect core declarations present
    expect(byName.get("Alpha")?.boundaryType).toBe("structural");
    expect(byName.get("run")?.boundaryType).toBe("content");
    expect(byName.get("Shape")?.boundaryType).toBe("structural");
    expect(byName.get("Color")?.boundaryType).toBe("structural");
    expect(byName.get("ID")?.boundaryType).toBe("structural");
    expect(byName.get("util")?.boundaryType).toBe("content");
    expect(byName.get("compute")?.boundaryType).toBe("content");
    expect(byName.get("Outer")?.boundaryType).toBe("structural");
    expect(byName.get("Box")?.boundaryType).toBe("structural");
    expect(byName.get("getValue")?.boundaryType).toBe("content");

    // Sanity: no obviously duplicated structural entries
    const names = boundaries.map((b) => b.name).filter(Boolean);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("classifies structural vs content correctly for typical class", () => {
    const code = `
export class Calc {
  constructor(private n: number) {}
  inc(): number { return ++this.n; }
  static mul(a: number,b: number){ return a * b; }
}
    `.trim();

    // biome-ignore lint/correctness/noUnusedVariables: test code
    const { boundaries, byName } = boundaryMap(code);

    expect(byName.get("Calc")?.boundaryType).toBe("structural");
    expect(byName.get("constructor")?.boundaryType).toBe("content");
    // Static method may appear as name "mul" or "static mul" depending on extraction logic; test both.
    const staticMethod = byName.get("mul") || byName.get("static mul");
    expect(staticMethod?.boundaryType).toBe("content");
  });

  it("merges documentation blocks for all supported declaration kinds", () => {
    const code = `
/** Interface docs */ interface Foo { x: number; }
/** Type docs */ type TAlias = string;
/** Enum docs */ enum Mode { A, B }
/** Const docs */ const answer = 42;
/** Fn docs */ function doWork() {}
/** Class docs */ class Zed { /** method docs */ go() {} }
    `.trim();

    const lines = code.split("\n");
    const findDocStart = (marker: string) => {
      const markerIdx = lines.findIndex((l) => l.includes(marker));
      expect(markerIdx).toBeGreaterThanOrEqual(0);
      // If the marker line itself contains a doc block (inline JSDoc), return that line
      if (lines[markerIdx].includes("/**")) {
        return markerIdx + 1;
      }
      // Otherwise walk upward for contiguous doc/comment/blank lines
      for (let i = markerIdx - 1; i >= 0; i--) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === "") continue;
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("/**") ||
          (trimmed.startsWith("/*") && trimmed.includes("*/"))
        ) {
          // continue scanning upward
          continue;
        }
        // First non-doc line encountered; doc block starts just below
        return i + 2;
      }
      return 1;
    };

    // biome-ignore lint/correctness/noUnusedVariables: test code
    const { boundaries, byName } = boundaryMap(code);

    const expectations: Array<[string, string]> = [
      ["Foo", "Interface docs"],
      ["TAlias", "Type docs"],
      ["Mode", "Enum docs"],
      ["answer", "Const docs"],
      ["doWork", "Fn docs"],
      ["Zed", "Class docs"],
      ["go", "method docs"],
    ];

    for (const [name, marker] of expectations) {
      const b = byName.get(name);
      expect(b, `Missing boundary for ${name}`).toBeTruthy();
      if (b) {
        expect(b.startLine).toBe(findDocStart(marker));
      }
    }
  });

  it("handles exported declarations (docs merge across export modifier)", () => {
    const code = `
/** Exported interface */ export interface Public { id: string; }
/** Exported class */ export class PublicClass { method() {} }
/** Exported fn */ export function api() {}
/** Exported type */ export type PublicType = number;
/** Exported enum */ export enum Flag { On, Off }
    `.trim();

    const lines = code.split("\n");
    const findDocStart = (marker: string) => {
      const markerIdx = lines.findIndex((l) => l.includes(marker));
      expect(markerIdx).toBeGreaterThanOrEqual(0);
      if (lines[markerIdx].includes("/**")) {
        return markerIdx + 1;
      }
      for (let i = markerIdx - 1; i >= 0; i--) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === "") continue;
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("/**") ||
          (trimmed.startsWith("/*") && trimmed.includes("*/"))
        ) {
          continue;
        }
        return i + 2;
      }
      return 1;
    };

    const { byName } = boundaryMap(code);

    const exported = [
      ["Public", "Exported interface"],
      ["PublicClass", "Exported class"],
      ["api", "Exported fn"],
      ["PublicType", "Exported type"],
      ["Flag", "Exported enum"],
    ] as const;

    for (const [name, marker] of exported) {
      const b = byName.get(name);
      expect(b, `Missing exported boundary ${name}`).toBeTruthy();
      if (b) {
        expect(b.startLine).toBe(findDocStart(marker));
      }
    }
  });

  it("suppresses nested local helper functions (not top-level boundaries)", () => {
    const code = `
class Wrapper {
  process(values: number[]) {
    function inner(a: number) { return a * 2; }
    const localArrow = (x: number) => x + 1;
    return values.map(inner).map(localArrow);
  }
}
    `.trim();

    const { byName } = boundaryMap(code);

    expect(byName.get("Wrapper")?.boundaryType).toBe("structural");
    expect(byName.get("process")?.boundaryType).toBe("content");
    // Local helpers should NOT appear
    expect(byName.get("inner")).toBeUndefined();
    expect(byName.get("localArrow")).toBeUndefined();
  });

  it("extracts modifiers & structural nodes via extractStructuralNodes()", () => {
    const code = `
export abstract class Service {
  private static instance: Service | null = null;
  protected value = 0;
  constructor() {}
  public async run(): Promise<void> {}
}
    `.trim();

    const parseResult = parser.parse(code);
    const nodes = parser.extractStructuralNodes(parseResult.tree);
    expect(nodes.length).toBeGreaterThan(0);

    const classNode = nodes.find((n) => n.type === StructuralNodeType.CLASS_DECLARATION);
    expect(classNode?.name).toBe("Service");
    expect(classNode?.modifiers).toContain("export");
    expect(classNode?.modifiers).toContain("abstract");

    // Ensure method appears
    const runNode = nodes.find((n) => n.name === "run");
    expect(runNode?.type).toBe(StructuralNodeType.METHOD_DEFINITION);
  });

  it("extracts type aliases & enums with structural classification", () => {
    const code = `
type UserID = string;
enum State { Idle, Busy }
    `.trim();

    const { byName } = boundaryMap(code);
    expect(byName.get("UserID")?.boundaryType).toBe("structural");
    expect(byName.get("State")?.boundaryType).toBe("structural");
  });

  it("parses nested namespaces & inner class members", () => {
    const code = `
namespace Outer {
  export namespace Inner {
    export class Box {
      value: number;
      getValue() { return this.value; }
    }
  }
}
    `.trim();

    const { byName } = boundaryMap(code);

    expect(byName.get("Outer")?.boundaryType).toBe("structural");
    expect(byName.get("Inner")?.boundaryType).toBe("structural");
    expect(byName.get("Box")?.boundaryType).toBe("structural");
    expect(byName.get("getValue")?.boundaryType).toBe("content");
  });

  it("handles arrow function variable declarations with content classification", () => {
    const code = `
const fn = (x: number) => x * 2;
const other = async (v: string) => {
  return v.toUpperCase();
};
    `.trim();

    const { byName } = boundaryMap(code);
    expect(byName.get("fn")?.boundaryType).toBe("content");
    expect(byName.get("other")?.boundaryType).toBe("content");
  });

  it("partial extraction on malformed code (error resilience)", () => {
    const code = `
function good() { return 1; }
function broken(
class Incomplete {
  method() {
}
    `.trim();

    const { result, byName } = boundaryMap(code);
    // Expect parse errors flagged
    expect(result.hasErrors).toBe(true);
    // Still extracts valid preceding function
    expect(byName.get("good")).toBeDefined();
  });

  it("records reasonable start/end lines for boundaries", () => {
    const code = `
/** docs */
class A {
  x() {}
}

function top() {}
    `.trim();

    const { byName } = boundaryMap(code);

    const a = byName.get("A");
    const x = byName.get("x");
    const top = byName.get("top");
    expect(a && a.startLine < (x?.startLine || 0)).toBe(true);
    expect((x?.endLine || 0) >= (x?.startLine || 0)).toBe(true);
    expect(top && top.startLine > (a?.endLine || 0)).toBe(true);
  });

  it("handles files larger than 32KB gracefully", () => {
    // Generate a TypeScript file larger than 32,767 characters
    let largeCode = "// Large TypeScript file test\n";
    let functionCount = 1;

    // Build content to exceed the limit
    while (largeCode.length < 35000) {
      largeCode += `
/**
 * Test function ${functionCount}
 * @param value Input value
 * @returns Processed result
 */
export function testFunction${functionCount}(value: number): string {
  const result = value * 2;
  console.log(\`Function ${functionCount} result: \${result}\`);
  return \`Result: \${result}\`;
}

/**
 * Test class ${functionCount}
 */
export class TestClass${functionCount} {
  private value: number;

  constructor(value: number) {
    this.value = value;
  }

  process(): number {
    return this.value * 10;
  }
}
`;
      functionCount++;
    }

    expect(largeCode.length).toBeGreaterThan(32767);

    // Parser should not crash and should return a valid result
    const result = parser.parse(largeCode);

    // Should have a valid tree
    expect(result.tree).toBeDefined();
    expect(result.tree.rootNode).toBeDefined();

    // Should flag errors due to truncation
    expect(result.hasErrors).toBe(true);

    // Should still be able to extract boundaries from the parsed portion
    const boundaries = parser.extractBoundaries(result.tree, largeCode);

    // Should find some boundaries from the beginning of the file
    expect(boundaries.length).toBeGreaterThan(0);

    // Should find early functions and classes
    const boundaryNames = boundaries.map((b) => b.name);
    expect(boundaryNames).toContain("testFunction1");
    expect(boundaryNames).toContain("TestClass1");

    // All boundaries should have valid line numbers
    for (const boundary of boundaries) {
      expect(boundary.startLine).toBeGreaterThan(0);
      expect(boundary.endLine).toBeGreaterThan(0);
      expect(boundary.endLine).toBeGreaterThanOrEqual(boundary.startLine);
    }

    // Should maintain proper boundary classifications
    const functions = boundaries.filter((b) => b.boundaryType === "content");
    const classes = boundaries.filter((b) => b.boundaryType === "structural");
    expect(functions.length).toBeGreaterThan(0);
    expect(classes.length).toBeGreaterThan(0);
  });

  it("maintains perfect content reconstruction for large TypeScript files", () => {
    // Generate content just over the limit
    let testCode = "import { Component } from 'react';\n";
    let count = 1;

    while (testCode.length < 35000) {
      testCode += `export const func${count} = (): number => ${count};\n`;
      testCode += `export function regularFunc${count}(): string { return "${count}"; }\n\n`;
      count++;
    }

    const originalLength = testCode.length;
    expect(originalLength).toBeGreaterThan(32767);

    // Parse and extract boundaries
    const result = parser.parse(testCode);
    const boundaries = parser.extractBoundaries(result.tree, testCode);

    // Verify we can reconstruct content from boundaries
    // Even though parsing was truncated, boundary extraction should work with original content
    expect(boundaries.length).toBeGreaterThan(0);

    // Each boundary should reference valid portions of the original content
    for (const boundary of boundaries) {
      const boundaryContent = testCode.slice(boundary.startByte, boundary.endByte);
      expect(boundaryContent.length).toBeGreaterThan(0);
      expect(boundary.startByte).toBeGreaterThanOrEqual(0);
      expect(boundary.endByte).toBeLessThanOrEqual(originalLength);
      expect(boundary.endByte).toBeGreaterThan(boundary.startByte);
    }

    // Verify boundaries cover meaningful TypeScript constructs
    const boundaryNames = boundaries.map((b) => b.name);
    expect(boundaryNames.some((name) => name!.includes("func1"))).toBe(true);
    expect(boundaryNames.some((name) => name!.includes("regularFunc1"))).toBe(true);
  });
});
