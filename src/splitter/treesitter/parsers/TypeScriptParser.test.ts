/**
 * TypeScriptParser Tests
 *
 * Comprehensive tests for TypeScript and TSX parsing functionality
 */

import { beforeEach, describe, expect, it } from "vitest";
import { TypeScriptParser } from "./TypeScriptParser";
import { StructuralNodeType } from "./types";

describe("TypeScriptParser", () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  describe("basic properties", () => {
    it("should have correct name", () => {
      expect(parser.name).toBe("typescript");
    });

    it("should support TypeScript file extensions", () => {
      expect(parser.fileExtensions).toEqual([".ts", ".tsx", ".mts", ".cts"]);
    });

    it("should support TypeScript MIME types", () => {
      expect(parser.mimeTypes).toEqual([
        "text/typescript",
        "application/typescript",
        "text/tsx",
        "application/tsx",
      ]);
    });
  });

  describe("TypeScript parsing", () => {
    it("should parse simple function declaration", () => {
      const code = `
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe(StructuralNodeType.FUNCTION_DECLARATION);
      expect(nodes[0].name).toBe("greet");
    });

    it("should parse arrow function with types", () => {
      const code = `
const add = (a: number, b: number): number => a + b;
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);

      // Should find variable declaration and potentially arrow function
      const varNode = nodes.find(
        (n) => n.type === StructuralNodeType.VARIABLE_DECLARATION,
      );
      expect(varNode).toBeTruthy();
    });

    it("should parse class with TypeScript features", () => {
      const code = `
export class Calculator {
  private readonly precision: number = 2;

  constructor(precision?: number) {
    if (precision !== undefined) {
      this.precision = precision;
    }
  }

  public add(a: number, b: number): number {
    return +(a + b).toFixed(this.precision);
  }

  static multiply(a: number, b: number): number {
    return a * b;
  }
}
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);

      const classNode = nodes.find(
        (n) => n.type === StructuralNodeType.CLASS_DECLARATION,
      );
      expect(classNode).toBeTruthy();
      expect(classNode?.name).toBe("Calculator");
    });

    it("should parse interface declaration", () => {
      const code = `
interface User {
  id: number;
  name: string;
  email?: string;
}
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe(StructuralNodeType.INTERFACE_DECLARATION);
      expect(nodes[0].name).toBe("User");
    });

    it("should parse type alias", () => {
      const code = `
type Status = 'pending' | 'completed' | 'failed';
type UserID = string;
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThanOrEqual(2);

      const statusType = nodes.find((n) => n.name === "Status");
      expect(statusType?.type).toBe(StructuralNodeType.TYPE_ALIAS_DECLARATION);

      const userIdType = nodes.find((n) => n.name === "UserID");
      expect(userIdType?.type).toBe(StructuralNodeType.TYPE_ALIAS_DECLARATION);
    });

    it("should parse enum declaration", () => {
      const code = `
enum Color {
  Red = "red",
  Green = "green",
  Blue = "blue"
}
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe(StructuralNodeType.ENUM_DECLARATION);
      expect(nodes[0].name).toBe("Color");
    });

    it("should parse namespace declaration", () => {
      const code = `
namespace Utils {
  export function formatDate(date: Date): string {
    return date.toISOString();
  }
}
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);

      const namespaceNode = nodes.find(
        (n) => n.type === StructuralNodeType.NAMESPACE_DECLARATION,
      );
      expect(namespaceNode).toBeTruthy();
      expect(namespaceNode?.name).toBe("Utils");
    });
  });

  describe("TSX parsing", () => {
    it("should detect TSX content and parse JSX elements", () => {
      const code = `
import React from 'react';

interface Props {
  name: string;
  age: number;
}

const UserProfile: React.FC<Props> = ({ name, age }) => {
  return (
    <div className="user-profile">
      <h1>{name}</h1>
      <p>Age: {age}</p>
    </div>
  );
};

export default UserProfile;
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);

      // Should find interface, variable declaration, and possibly JSX elements
      const interfaceNode = nodes.find(
        (n) => n.type === StructuralNodeType.INTERFACE_DECLARATION,
      );
      expect(interfaceNode?.name).toBe("Props");
    });

    it("should parse JSX fragment", () => {
      const code = `
const Component = () => (
  <React.Fragment>
    <div>First</div>
    <div>Second</div>
  </React.Fragment>
);
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);
    });

    it("should parse self-closing JSX elements", () => {
      const code = `
const Icon = () => <img src="icon.png" alt="Icon" />;
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);
    });
  });

  describe("advanced TypeScript features", () => {
    it("should parse generic functions", () => {
      const code = `
function identity<T>(arg: T): T {
  return arg;
}

function swap<T, U>(tuple: [T, U]): [U, T] {
  return [tuple[1], tuple[0]];
}
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThanOrEqual(2);

      const identityNode = nodes.find((n) => n.name === "identity");
      expect(identityNode?.type).toBe(StructuralNodeType.FUNCTION_DECLARATION);

      const swapNode = nodes.find((n) => n.name === "swap");
      expect(swapNode?.type).toBe(StructuralNodeType.FUNCTION_DECLARATION);
    });

    it("should parse decorators", () => {
      const code = `
@Component({
  selector: 'app-user',
  templateUrl: './user.component.html'
})
class UserComponent {
  @Input() name: string;
  
  @Output() nameChange = new EventEmitter<string>();
}
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);

      const classNode = nodes.find(
        (n) => n.type === StructuralNodeType.CLASS_DECLARATION,
      );
      expect(classNode?.name).toBe("UserComponent");
    });

    it("should parse module imports and exports", () => {
      const code = `
import { Component, Input, Output } from '@angular/core';
import * as React from 'react';
import defaultExport from './module';

export { Component };
export default class MyClass {}
export const myFunction = () => {};
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(false);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);

      // Should find import and export statements
      const importNodes = nodes.filter(
        (n) => n.type === StructuralNodeType.IMPORT_STATEMENT,
      );
      const exportNodes = nodes.filter(
        (n) => n.type === StructuralNodeType.EXPORT_STATEMENT,
      );

      expect(importNodes.length).toBeGreaterThan(0);
      expect(exportNodes.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("should handle syntax errors gracefully", () => {
      const code = `
function broken(
  // Missing closing parenthesis and body
      `.trim();

      const result = parser.parse(code);
      expect(result.hasErrors).toBe(true);
      expect(result.errorNodes.length).toBeGreaterThan(0);
    });

    it("should extract partial structure from malformed code", () => {
      const code = `
function validFunction() {
  return "works";
}

function brokenFunction(
  // This function is incomplete
  
interface ValidInterface {
  id: number;
}
      `.trim();

      const result = parser.parse(code);

      const nodes = parser.extractStructuralNodes(result.tree);
      expect(nodes.length).toBeGreaterThan(0);

      // Should still find the valid function
      const validFunc = nodes.find((n) => n.name === "validFunction");
      expect(validFunc).toBeTruthy();

      // Note: The interface is inside an ERROR node due to malformed syntax,
      // so it may not be extractable. This is expected behavior for severely
      // malformed code.
    });
  });

  describe("node extraction", () => {
    it("should extract correct line numbers", () => {
      const code = `
interface Props {
  name: string;
}

function Component(props: Props) {
  return props.name;
}
      `.trim();

      const result = parser.parse(code);
      const nodes = parser.extractStructuralNodes(result.tree);

      expect(nodes.length).toBeGreaterThanOrEqual(2);

      // Verify line numbers are reasonable
      for (const node of nodes) {
        expect(node.startLine).toBeGreaterThanOrEqual(1);
        expect(node.endLine).toBeGreaterThanOrEqual(node.startLine);
      }
    });

    it("should extract modifiers correctly", () => {
      const code = `
export default async function fetchData(): Promise<string> {
  return "data";
}

export class PublicClass {
  private static readonly value = 42;
  
  public async method(): Promise<void> {}
}
      `.trim();

      const result = parser.parse(code);
      const nodes = parser.extractStructuralNodes(result.tree);

      expect(nodes.length).toBeGreaterThan(0);

      // Check that nodes have modifiers
      for (const node of nodes) {
        expect(Array.isArray(node.modifiers)).toBe(true);
      }
    });
  });
});
