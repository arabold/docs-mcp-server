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

const parser = new TypeScriptParser(30000);

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
  constructor(private n: number) {}
  static mul(a: number, b: number) { return a * b; }
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

const other = async (v: string) => {
  return v.toUpperCase();
};

namespace Outer {
  export namespace Inner {
    export class Box {
      value: number;
      getValue(): number { return this.value; }
    }
  }
}
    `.trim();

    const { boundaries, byName } = boundaryMap(code);

    const expected: Array<[name: string, boundaryType: "structural" | "content"]> = [
      ["Alpha", "structural"],
      ["run", "content"],
      ["constructor", "content"],
      ["Shape", "structural"],
      ["Color", "structural"],
      ["ID", "structural"],
      ["util", "content"],
      ["compute", "content"],
      ["other", "content"],
      ["Outer", "structural"],
      ["Inner", "structural"],
      ["Box", "structural"],
      ["getValue", "content"],
    ];
    for (const [name, boundaryType] of expected) {
      expect.soft(byName.get(name)?.boundaryType, name).toBe(boundaryType);
    }
    // Static method may appear as name "mul" or "static mul" depending on extraction logic; test both.
    const staticMethod = byName.get("mul") || byName.get("static mul");
    expect(staticMethod?.boundaryType).toBe("content");

    // Sanity: no obviously duplicated structural entries
    const names = boundaries.map((b) => b.name).filter(Boolean);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("starts each boundary at its documentation block, also across an export modifier", () => {
    const code = `
/** Interface docs */ interface Foo { x: number; }
/** Type docs */ type TAlias = string;
/** Enum docs */ enum Mode { A, B }
/** Const docs */ const answer = 42;
/** Fn docs */ function doWork() {}
/** Class docs */ class Zed { /** method docs */ go() {} }
/** Exported interface */ export interface Public { id: string; }
/** Exported class */ export class PublicClass { method() {} }
/** Exported fn */ export function api() {}
/** Exported type */ export type PublicType = number;
/** Exported enum */ export enum Flag { On, Off }
/** docs */
class A {
  x() {}
}

function top() {}
    `.trim();

    const lines = code.split("\n");
    /** The 1-based line holding `marker`. */
    const lineOf = (marker: string) => lines.findIndex((l) => l.includes(marker)) + 1;
    const { byName } = boundaryMap(code);

    const expectations: Array<[name: string, startsAt: string]> = [
      ["Foo", "Interface docs"],
      ["TAlias", "Type docs"],
      ["Mode", "Enum docs"],
      ["answer", "Const docs"],
      ["doWork", "Fn docs"],
      ["Zed", "Class docs"],
      ["go", "method docs"],
      ["Public", "Exported interface"],
      ["PublicClass", "Exported class"],
      ["api", "Exported fn"],
      ["PublicType", "Exported type"],
      ["Flag", "Exported enum"],
      // A doc block on its own line moves the start up to it.
      ["A", "/** docs */"],
      ["x", "x() {}"],
      ["top", "function top"],
    ];

    for (const [name, startsAt] of expectations) {
      const b = byName.get(name);
      expect.soft(b?.startLine, `${name}: start`).toBe(lineOf(startsAt));
      expect.soft((b?.endLine ?? 0) >= (b?.startLine ?? 1), `${name}: end`).toBe(true);
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

  it("extracts valid boundaries from the parsed part of a file larger than 32KB", () => {
    // Generate a TypeScript file larger than 32,767 characters
    let largeCode = "// Large TypeScript file test\n";
    let functionCount = 1;
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

    const result = parser.parse(largeCode);
    // Should flag errors due to truncation
    expect(result.hasErrors).toBe(true);

    // Boundaries from the beginning of the file are still found and classified
    const boundaries = parser.extractBoundaries(result.tree, largeCode);
    const boundaryNames = boundaries.map((b) => b.name);
    expect(boundaryNames).toContain("testFunction1");
    expect(boundaryNames).toContain("TestClass1");
    expect(boundaries.some((b) => b.boundaryType === "content")).toBe(true);
    expect(boundaries.some((b) => b.boundaryType === "structural")).toBe(true);

    // Every boundary points at a valid, non-empty part of the original content
    for (const boundary of boundaries) {
      expect(boundary.startLine).toBeGreaterThan(0);
      expect(boundary.endLine).toBeGreaterThanOrEqual(boundary.startLine);
      expect(boundary.startByte).toBeGreaterThanOrEqual(0);
      expect(boundary.endByte).toBeGreaterThan(boundary.startByte);
      expect(boundary.endByte).toBeLessThanOrEqual(largeCode.length);
    }
  });
});
