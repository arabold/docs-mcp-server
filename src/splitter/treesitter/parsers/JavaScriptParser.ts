/**
 * JavaScriptParser - Tree-sitter parser for JavaScript and JSX files
 *
 * Handles parsing and structural node extraction for JavaScript source code,
 * including ES6+ features, arrow functions, classes, and JSX elements.
 */

import type { SyntaxNode } from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import { BaseLanguageParser } from "./BaseLanguageParser";
import { StructuralNodeType } from "./types";

export class JavaScriptParser extends BaseLanguageParser {
  readonly name = "javascript";
  readonly fileExtensions = [".js", ".jsx", ".mjs", ".cjs"];
  readonly mimeTypes = [
    "text/javascript",
    "application/javascript",
    "text/jsx",
    "application/jsx",
  ];

  protected setupLanguage(): void {
    this.parser.setLanguage(JavaScript);
  }

  protected getStructuralNodeTypes(): Set<string> {
    return new Set([
      // Function declarations
      "function_declaration",
      "arrow_function",
      "method_definition",
      "constructor",

      // Class declarations
      "class_declaration",

      // Object expressions (for object methods)
      "object_expression",

      // JSX elements
      "jsx_element",
      "jsx_fragment",

      // Variable declarations (for arrow functions assigned to variables)
      "variable_declaration",

      // Export/import statements
      "export_statement",
      "import_statement",
    ]);
  }

  protected extractNodeName(node: SyntaxNode, source: string): string {
    switch (node.type) {
      case "function_declaration":
        return this.extractFunctionName(node, source);

      case "class_declaration":
        return this.extractClassName(node, source);

      case "method_definition":
        return this.extractMethodName(node, source);

      case "variable_declaration":
        return this.extractVariableName(node, source);

      case "arrow_function":
        return this.extractArrowFunctionName(node, source);

      case "jsx_element":
        return this.extractJSXElementName(node, source);

      case "jsx_fragment":
        return "JSXFragment";

      case "export_statement":
        return "export";

      case "import_statement":
        return "import";

      default:
        return node.type;
    }
  }

  protected extractNodeModifiers(node: SyntaxNode, _source: string): string[] {
    const modifiers: string[] = [];

    // Check for export modifier
    if (this.hasExportModifier(node)) {
      modifiers.push("export");
    }

    // Check for async modifier
    if (this.hasAsyncModifier(node)) {
      modifiers.push("async");
    }

    // Check for static modifier (for class methods)
    if (this.hasStaticModifier(node)) {
      modifiers.push("static");
    }

    // Check for access modifiers (if TypeScript features are present)
    const accessModifier = this.getAccessModifier(node);
    if (accessModifier) {
      modifiers.push(accessModifier);
    }

    return modifiers;
  }

  private extractFunctionName(node: SyntaxNode, _source: string): string {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return nameNode.text;
    }
    return "anonymous";
  }

  private extractClassName(node: SyntaxNode, _source: string): string {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return nameNode.text;
    }
    return "AnonymousClass";
  }

  private extractMethodName(node: SyntaxNode, _source: string): string {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return nameNode.text;
    }
    return "method";
  }

  private extractVariableName(node: SyntaxNode, _source: string): string {
    // Look for variable declarators that contain arrow functions
    const declarator = node.children.find(
      (child) => child.type === "variable_declarator",
    );
    if (!declarator) return "variable";

    const nameNode = declarator.childForFieldName("name");
    if (!nameNode) return "variable";

    // Check if the value is an arrow function
    const valueNode = declarator.childForFieldName("value");
    if (valueNode?.type === "arrow_function") {
      return nameNode.text;
    }

    return "variable";
  }

  private extractArrowFunctionName(node: SyntaxNode, _source: string): string {
    // For arrow functions, try to find the variable name from parent
    let parent = node.parent;
    while (parent) {
      if (parent.type === "variable_declarator") {
        const nameNode = parent.childForFieldName("name");
        return nameNode ? nameNode.text : "arrow";
      }
      if (parent.type === "property") {
        const keyNode = parent.childForFieldName("key");
        return keyNode ? keyNode.text : "arrow";
      }
      parent = parent.parent;
    }
    return "arrow";
  }

  private extractJSXElementName(node: SyntaxNode, _source: string): string {
    const openingElement = node.childForFieldName("opening_element");
    if (!openingElement) return "JSXElement";

    const nameNode = openingElement.childForFieldName("name");
    return nameNode ? nameNode.text : "JSXElement";
  }

  protected classifyStructuralNode(node: SyntaxNode): StructuralNodeType {
    switch (node.type) {
      case "function_declaration":
        return StructuralNodeType.FUNCTION_DECLARATION;
      case "arrow_function":
        return StructuralNodeType.ARROW_FUNCTION;
      case "method_definition":
        return StructuralNodeType.METHOD_DEFINITION;
      case "constructor":
        return StructuralNodeType.CONSTRUCTOR;
      case "class_declaration":
        return StructuralNodeType.CLASS_DECLARATION;
      case "variable_declaration":
        return StructuralNodeType.VARIABLE_DECLARATION;
      case "jsx_element":
      case "jsx_fragment":
        return StructuralNodeType.JSX_ELEMENT;
      case "export_statement":
        return StructuralNodeType.EXPORT_STATEMENT;
      case "import_statement":
        return StructuralNodeType.IMPORT_STATEMENT;
      case "object_expression":
        return StructuralNodeType.OBJECT_EXPRESSION;
      default:
        return StructuralNodeType.VARIABLE_DECLARATION; // Default fallback
    }
  }

  private hasExportModifier(node: SyntaxNode): boolean {
    return node.parent?.type === "export_statement" || false;
  }

  private hasAsyncModifier(node: SyntaxNode): boolean {
    // Check for async keyword in function declarations and arrow functions
    return node.children.some((child) => child.type === "async");
  }

  private hasStaticModifier(node: SyntaxNode): boolean {
    // Check for static keyword in method definitions
    return node.children.some((child) => child.type === "static");
  }

  private getAccessModifier(node: SyntaxNode): string | null {
    // Check for access modifiers (public, private, protected)
    const modifierNode = node.children.find((child) =>
      ["public", "private", "protected"].includes(child.type),
    );
    return modifierNode ? modifierNode.type : null;
  }
}
