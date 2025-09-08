/**
 * TypeScriptParser - Tree-sitter parser for TypeScript and TSX files
 *
 * Handles parsing and structural node extraction for TypeScript source code,
 * including types, interfaces, enums, decorators, and TSX elements.
 */

import type { SyntaxNode } from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import { BaseLanguageParser } from "./BaseLanguageParser";
import type { ParseResult } from "./types";
import { StructuralNodeType } from "./types";

export class TypeScriptParser extends BaseLanguageParser {
  readonly name = "typescript";
  readonly fileExtensions = [".ts", ".tsx", ".mts", ".cts"];
  readonly mimeTypes = [
    "text/typescript",
    "application/typescript",
    "text/tsx",
    "application/tsx",
  ];

  private isTSX = false;

  protected setupLanguage(): void {
    // Determine if we're parsing TSX based on file extension or content
    this.parser.setLanguage(this.isTSX ? TypeScript.tsx : TypeScript.typescript);
  }

  /**
   * Override parse to detect TSX content
   */
  parse(content: string): ParseResult {
    // Check if this is TSX content
    this.isTSX = this.isTSXContent(undefined, content);
    this.setupLanguage(); // Re-setup language with correct parser
    return super.parse(content);
  }

  protected getStructuralNodeTypes(): Set<string> {
    return new Set([
      // Function declarations
      "function_declaration",
      "arrow_function",
      "method_definition",
      "constructor",
      "function_signature",

      // Class declarations
      "class_declaration",
      "abstract_class_declaration",

      // Interface and type declarations
      "interface_declaration",
      "type_alias_declaration",

      // Enum declarations
      "enum_declaration",

      // Module declarations
      "module_declaration",
      "namespace_declaration",
      "internal_module", // TypeScript namespace in some versions

      // Object expressions
      "object_expression",

      // JSX/TSX elements (when parsing TSX)
      "jsx_element",
      "jsx_fragment",
      "jsx_self_closing_element",

      // Variable declarations (for arrow functions)
      "variable_declaration",
      "lexical_declaration", // For const/let declarations in TypeScript
      "variable_declarator", // For individual variable declarators

      // Export/import statements (lower priority than their contents)
      "export_statement",
      "import_statement",

      // Decorators
      "decorator",
    ]);
  }

  protected extractNodeName(node: SyntaxNode, _source: string): string {
    switch (node.type) {
      case "function_declaration":
      case "class_declaration":
      case "interface_declaration":
      case "type_alias_declaration":
      case "enum_declaration":
      case "module_declaration":
      case "namespace_declaration":
      case "internal_module": {
        const nameNode = node.childForFieldName("name");
        return nameNode?.text || `<anonymous_${node.type}>`;
      }

      case "method_definition": {
        const nameNode = node.childForFieldName("name");
        const isStatic = this.hasModifier(node, "static");
        const name = nameNode?.text || "<anonymous_method>";
        return isStatic ? `static ${name}` : name;
      }

      case "constructor":
        return "constructor";

      case "function_signature": {
        const nameNode = node.childForFieldName("name");
        return nameNode?.text || "<anonymous_signature>";
      }

      case "arrow_function": {
        // For arrow functions, try to get the variable name from parent
        const parent = node.parent;
        if (parent?.type === "variable_declarator") {
          const nameNode = parent.childForFieldName("name");
          return nameNode?.text || "<anonymous_arrow>";
        }
        return "<anonymous_arrow>";
      }

      case "variable_declaration":
      case "lexical_declaration": {
        // Extract variable names from declarators
        const declarators = node.children.filter(
          (child) => child.type === "variable_declarator",
        );
        const names = declarators
          .map((declarator) => {
            const nameNode = declarator.childForFieldName("name");
            return nameNode?.text;
          })
          .filter(Boolean);
        return names.length > 0 ? names.join(", ") : "<anonymous_variable>";
      }

      case "variable_declarator": {
        const nameNode = node.childForFieldName("name");
        return nameNode?.text || "<anonymous_declarator>";
      }

      case "jsx_element":
      case "jsx_self_closing_element": {
        const openingElement = node.childForFieldName("opening_element") || node;
        const nameNode = openingElement.childForFieldName("name");
        return `<${nameNode?.text || "Unknown"}>`;
      }

      case "jsx_fragment":
        return "<React.Fragment>";

      case "decorator": {
        const nameNode = node.children.find(
          (child) => child.type === "identifier" || child.type === "member_expression",
        );
        return `@${nameNode?.text || "unknown"}`;
      }

      case "export_statement":
      case "import_statement":
        return this.extractImportExportName(node);

      default:
        return node.text.slice(0, 50).replace(/\s+/g, " ").trim();
    }
  }

  protected extractNodeModifiers(node: SyntaxNode, _source: string): string[] {
    const modifiers: string[] = [];

    // Check for TypeScript access modifiers
    if (this.hasModifier(node, "public")) modifiers.push("public");
    if (this.hasModifier(node, "private")) modifiers.push("private");
    if (this.hasModifier(node, "protected")) modifiers.push("protected");
    if (this.hasModifier(node, "readonly")) modifiers.push("readonly");
    if (this.hasModifier(node, "static")) modifiers.push("static");
    if (this.hasModifier(node, "abstract")) modifiers.push("abstract");
    if (this.hasModifier(node, "async")) modifiers.push("async");
    if (this.hasModifier(node, "export")) modifiers.push("export");
    if (this.hasModifier(node, "default")) modifiers.push("default");

    return modifiers;
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
      case "function_signature":
        return StructuralNodeType.FUNCTION_DECLARATION; // closest match

      case "class_declaration":
      case "abstract_class_declaration":
        return StructuralNodeType.CLASS_DECLARATION;

      case "interface_declaration":
        return StructuralNodeType.INTERFACE_DECLARATION;

      case "type_alias_declaration":
        return StructuralNodeType.TYPE_ALIAS_DECLARATION;

      case "enum_declaration":
        return StructuralNodeType.ENUM_DECLARATION;

      case "module_declaration":
      case "namespace_declaration":
      case "internal_module":
        return StructuralNodeType.NAMESPACE_DECLARATION;

      case "variable_declaration":
      case "lexical_declaration":
      case "variable_declarator":
        return StructuralNodeType.VARIABLE_DECLARATION;

      case "jsx_element":
      case "jsx_fragment":
      case "jsx_self_closing_element":
        return StructuralNodeType.JSX_ELEMENT;

      case "decorator":
        return StructuralNodeType.JSX_ELEMENT; // No decorator type, use JSX_ELEMENT

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

  /**
   * Check if a node has a specific modifier
   */
  private hasModifier(node: SyntaxNode, modifier: string): boolean {
    return node.children.some((child) => child.type === modifier);
  }

  /**
   * Extract name from import/export statements
   */
  private extractImportExportName(node: SyntaxNode): string {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      return `import from ${sourceNode?.text || "unknown"}`;
    }

    if (node.type === "export_statement") {
      const declarationNode = node.childForFieldName("declaration");
      if (declarationNode) {
        const nameNode = declarationNode.childForFieldName("name");
        return `export ${nameNode?.text || "unknown"}`;
      }
      return "export";
    }

    return node.text.slice(0, 30).replace(/\s+/g, " ").trim();
  }

  /**
   * Determine if content is TSX based on content type or JSX syntax
   */
  private isTSXContent(contentType?: string, content?: string): boolean {
    // Check by content type
    if (contentType?.includes("tsx") || contentType?.includes("TSX")) {
      return true;
    }

    // Check by file extension pattern
    if (contentType?.endsWith(".tsx")) {
      return true;
    }

    // Check for JSX syntax in content
    if (content) {
      // Look for JSX patterns
      const jsxPatterns = [
        /<[A-Z][a-zA-Z0-9]*[\s>]/, // Component tags
        /<[a-z]+[\s>]/, // HTML tags
        /React\./, // React imports
        /jsx/i, // JSX mentions
      ];

      return jsxPatterns.some((pattern) => pattern.test(content));
    }

    return false;
  }
}
