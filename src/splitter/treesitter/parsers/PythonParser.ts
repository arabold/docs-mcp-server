/**
 * PythonParser - TreeSitter-based Python language parser
 *
 * This parser implements Python-specific syntax-aware source code splitting
 * with proper docstring handling and hierarchical structure generation. It
 * identifies Python constructs like classes, functions, methods, and async
 * functions, and extracts both docstrings and hash comments.
 */

import type {
  LanguageDefinition,
  StructuralNodeType,
} from "../types";
import { StructuralNodeType } from "../types";
import { BaseLanguageParser } from "./BaseLanguageParser";

export class PythonParser extends BaseLanguageParser {
  /**
   * Get the language definition for Python
   */
  getLanguageDefinition(): LanguageDefinition {
    return {
      name: "python",
      extensions: [".py", ".pyw", ".pyi"],
      mimeTypes: ["text/x-python", "application/x-python"],
    };
  }

  /**
   * Get TreeSitter language object for Python parsing
   */
  getTreeSitterLanguage(): any {
    // Use direct require for CommonJS compatibility
    const treeSitterPython = require("tree-sitter-python");
    return treeSitterPython;
  }

  /**
   * Get the TreeSitter node types that represent structural elements in Python
   */
  getStructuralNodeTypes(): string[] {
    return [
      "function_definition",
      "class_definition", 
      "async_function_definition",
      "decorated_definition",
    ];
  }

  /**
   * Extract the name/identifier from a Python structural node
   */
  extractNodeName(node: any): string {
    // Handle decorated definitions (functions/classes with decorators)
    if (node.type === "decorated_definition") {
      const definition = node.children.find((child: any) => 
        child.type === "function_definition" || 
        child.type === "class_definition" ||
        child.type === "async_function_definition"
      );
      if (definition) {
        return this.extractNodeName(definition);
      }
    }

    // For function_definition, async_function_definition, and class_definition
    // Look for the identifier child node (typically the second child after the keyword)
    for (const child of node.children) {
      if (child.type === "identifier") {
        return child.text;
      }
    }

    // Fallback: try to extract from node text
    const text = node.text || "";
    const lines = text.split("\n");
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      // Match patterns like "def name(" or "class Name:"
      const match = firstLine.match(/(?:def|class|async def)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (match) {
        return match[1];
      }
    }

    return "";
  }

  /**
   * Extract modifiers from a Python structural node
   */
  extractNodeModifiers(node: any): string[] {
    const modifiers: string[] = [];

    // Handle async functions
    if (node.type === "async_function_definition") {
      modifiers.push("async");
    }

    // Handle decorated definitions (extract decorator names)
    if (node.type === "decorated_definition") {
      const decorators = node.children.filter((child: any) => child.type === "decorator");
      for (const decorator of decorators) {
        // Extract decorator name (e.g., @staticmethod, @property)
        const decoratorName = this.extractDecoratorName(decorator);
        if (decoratorName) {
          modifiers.push(`@${decoratorName}`);
        }
      }
    }

    // Check for common Python patterns in the name or surrounding context
    const name = this.extractNodeName(node);
    if (name.startsWith("_") && !name.startsWith("__")) {
      modifiers.push("protected");
    } else if (name.startsWith("__") && name.endsWith("__")) {
      modifiers.push("magic");
    } else if (name.startsWith("__")) {
      modifiers.push("private");
    }

    return modifiers;
  }

  /**
   * Classify a TreeSitter node into a StructuralNodeType
   */
  classifyStructuralNode(node: any): StructuralNodeType {
    // Handle decorated definitions by looking at the actual definition
    if (node.type === "decorated_definition") {
      const definition = node.children.find((child: any) => 
        child.type === "function_definition" || 
        child.type === "class_definition" ||
        child.type === "async_function_definition"
      );
      if (definition) {
        return this.classifyStructuralNode(definition);
      }
    }

    switch (node.type) {
      case "class_definition":
        return StructuralNodeType.CLASS;
      case "function_definition":
      case "async_function_definition":
        // For now, classify all functions as FUNCTION
        // We could enhance this to detect methods vs functions later
        return StructuralNodeType.FUNCTION;
      default:
        return StructuralNodeType.FUNCTION; // Default fallback
    }
  }

  /**
   * Extract documentation/comments associated with a Python structural node
   * Handles both docstrings and preceding hash comments
   */
  extractDocumentation(node: any, sourceCode: string): string | undefined {
    const lines = sourceCode.split("\n");
    const documentation: string[] = [];

    // Extract preceding hash comments
    const precedingComments = this.extractPrecedingComments(node, lines);
    if (precedingComments) {
      documentation.push(precedingComments);
    }

    // Extract docstring (first string literal in function/class body)
    const docstring = this.extractDocstring(node, lines);
    if (docstring) {
      documentation.push(docstring);
    }

    return documentation.length > 0 ? documentation.join("\n\n") : undefined;
  }

  /**
   * Extract decorator name from a decorator node
   */
  private extractDecoratorName(decoratorNode: any): string {
    // Decorator structure: @ identifier or @ dotted_name
    for (const child of decoratorNode.children) {
      if (child.type === "identifier") {
        return child.text;
      } else if (child.type === "dotted_name") {
        return child.text;
      } else if (child.type === "call") {
        // Handle parameterized decorators like @decorator(args)
        const func = child.children.find((c: any) => c.type === "identifier" || c.type === "dotted_name");
        return func ? func.text : "";
      }
    }
    return "";
  }

  /**
   * Extract preceding hash comments before a structural node
   */
  private extractPrecedingComments(node: any, lines: string[]): string | undefined {
    const startRow = node.startPosition.row;
    const comments: string[] = [];

    // Look backwards from the node start to find preceding comments
    for (let i = startRow - 1; i >= 0; i--) {
      const line = lines[i].trim();
      
      // Stop at empty lines or non-comment lines
      if (!line || !line.startsWith("#")) {
        break;
      }
      
      // Extract comment content (remove # and leading whitespace)
      const commentContent = line.substring(1).trim();
      comments.unshift(commentContent);
    }

    return comments.length > 0 ? comments.join("\n") : undefined;
  }

  /**
   * Extract docstring from a function or class definition
   */
  private extractDocstring(node: any, lines: string[]): string | undefined {
    // Find the function/class body
    const body = node.children.find((child: any) => child.type === "block");
    if (!body) return undefined;

    // Look for the first statement in the body
    const statements = body.children.filter((child: any) => child.type !== ":");
    if (statements.length === 0) return undefined;

    const firstStatement = statements[0];
    
    // Check if the first statement is an expression statement containing a string
    if (firstStatement.type === "expression_statement") {
      const expression = firstStatement.children[0];
      if (expression && (expression.type === "string" || expression.type === "concatenated_string")) {
        // Extract the string content
        const docstringLines = lines.slice(
          expression.startPosition.row,
          expression.endPosition.row + 1
        );
        
        let docstring = docstringLines.join("\n");
        
        // Handle single line case
        if (expression.startPosition.row === expression.endPosition.row) {
          const line = lines[expression.startPosition.row];
          docstring = line.substring(
            expression.startPosition.column,
            expression.endPosition.column
          );
        } else {
          // Trim first and last lines appropriately
          docstringLines[0] = docstringLines[0].substring(expression.startPosition.column);
          docstringLines[docstringLines.length - 1] = docstringLines[docstringLines.length - 1].substring(
            0,
            expression.endPosition.column
          );
          docstring = docstringLines.join("\n");
        }

        // Clean up the docstring (remove quotes and normalize whitespace)
        return this.cleanDocstring(docstring);
      }
    }

    return undefined;
  }

  /**
   * Clean and normalize a docstring by removing quotes and normalizing whitespace
   */
  private cleanDocstring(docstring: string): string {
    // Remove triple quotes or single quotes
    let cleaned = docstring.trim();
    
    // Remove triple quotes
    if (cleaned.startsWith('"""') && cleaned.endsWith('"""')) {
      cleaned = cleaned.slice(3, -3);
    } else if (cleaned.startsWith("'''") && cleaned.endsWith("'''")) {
      cleaned = cleaned.slice(3, -3);
    } else if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    } else if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.slice(1, -1);
    }

    // Normalize whitespace while preserving structure
    return cleaned.trim();
  }
}