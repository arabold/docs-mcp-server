/**
 * Tests for PythonParser - TreeSitter-based Python language parser
 */

import { beforeEach, describe, expect, it } from "vitest";
import { StructuralNodeType } from "../types";
import { PythonParser } from "./PythonParser";

describe("PythonParser", () => {
  let parser: PythonParser;

  beforeEach(() => {
    parser = new PythonParser();
  });

  describe("getLanguageDefinition", () => {
    it("should return correct Python language definition", () => {
      const langDef = parser.getLanguageDefinition();
      
      expect(langDef.name).toBe("python");
      expect(langDef.extensions).toEqual([".py", ".pyw", ".pyi"]);
      expect(langDef.mimeTypes).toEqual(["text/x-python", "application/x-python"]);
    });
  });

  describe("getStructuralNodeTypes", () => {
    it("should return correct Python structural node types", () => {
      const nodeTypes = parser.getStructuralNodeTypes();
      
      expect(nodeTypes).toContain("function_definition");
      expect(nodeTypes).toContain("class_definition");
      expect(nodeTypes).toContain("async_function_definition");
      expect(nodeTypes).toContain("decorated_definition");
    });
  });

  describe("Python source code splitting", () => {
    it("should split simple Python class with methods", async () => {
      const pythonCode = `
class Calculator:
    """A simple calculator class."""
    
    def __init__(self, name="Calculator"):
        """Initialize the calculator."""
        self.name = name
    
    def add(self, a, b):
        """Add two numbers."""
        return a + b
    
    def multiply(self, a, b):
        """Multiply two numbers."""
        return a * b
`;

      const chunks = await parser.splitText(pythonCode);
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should have chunks for class and methods
      const classChunk = chunks.find(chunk => 
        chunk.section?.path.includes("Calculator")
      );
      expect(classChunk).toBeDefined();
    });

    it("should split Python functions with decorators", async () => {
      const pythonCode = `
@staticmethod
def static_function():
    """A static function."""
    return "static"

@property
def getter_function(self):
    """A property getter."""
    return self._value

@app.route('/api')
def api_endpoint():
    """An API endpoint."""
    return {"message": "hello"}
`;

      const chunks = await parser.splitText(pythonCode);
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should have chunks for decorated functions
      const staticFunctionChunk = chunks.find(chunk => 
        chunk.section?.path.includes("static_function")
      );
      expect(staticFunctionChunk).toBeDefined();
    });

    it("should split async Python functions", async () => {
      const pythonCode = `
async def fetch_data(url):
    """Fetch data asynchronously."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()

async def process_data(data):
    """Process data asynchronously.""" 
    result = []
    for item in data:
        processed = await transform_item(item)
        result.append(processed)
    return result
`;

      const chunks = await parser.splitText(pythonCode);
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should have chunks for async functions
      const fetchDataChunk = chunks.find(chunk => 
        chunk.section?.path.includes("fetch_data")
      );
      expect(fetchDataChunk).toBeDefined();
    });

    it("should split complex Python class hierarchy", async () => {
      const pythonCode = `
# This is a comment before the class
class BaseModel:
    """Base model for all entities."""
    
    def __init__(self):
        """Initialize base model."""
        self.id = None
    
    def save(self):
        """Save the model."""
        pass
    
    def _validate(self):
        """Private validation method."""
        return True

class User(BaseModel):
    """User model extending BaseModel."""
    
    def __init__(self, username, email):
        """Initialize user with username and email."""
        super().__init__()
        self.username = username
        self.email = email
    
    @property
    def full_name(self):
        """Get the full name of the user."""
        return f"{self.first_name} {self.last_name}"
    
    @classmethod
    def create_user(cls, data):
        """Create a new user from data."""
        return cls(data['username'], data['email'])
`;

      const chunks = await parser.splitText(pythonCode);
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should have chunks for both classes and their methods
      const baseModelChunk = chunks.find(chunk => 
        chunk.section?.path.includes("BaseModel")
      );
      const userChunk = chunks.find(chunk => 
        chunk.section?.path.includes("User")
      );
      
      expect(baseModelChunk).toBeDefined();
      expect(userChunk).toBeDefined();
    });

    it("should handle module-level functions", async () => {
      const pythonCode = `
#!/usr/bin/env python3
"""
Module for utility functions.

This module provides various utility functions
for data processing and validation.
"""

import os
import sys
from typing import Optional, List

def validate_email(email: str) -> bool:
    """Validate an email address."""
    import re
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def process_file(filepath: str) -> Optional[List[str]]:
    """Process a file and return lines."""
    if not os.path.exists(filepath):
        return None
    
    with open(filepath, 'r') as f:
        return f.readlines()

if __name__ == "__main__":
    # Test the functions
    print(validate_email("test@example.com"))
`;

      const chunks = await parser.splitText(pythonCode);
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should have chunks for module-level functions
      const validateEmailChunk = chunks.find(chunk => 
        chunk.section?.path.includes("validate_email")
      );
      const processFileChunk = chunks.find(chunk => 
        chunk.section?.path.includes("process_file")
      );
      
      expect(validateEmailChunk).toBeDefined();
      expect(processFileChunk).toBeDefined();
    });

    it("should create proper hierarchical paths", async () => {
      const pythonCode = `
class Service:
    def public_method(self):
        """A public method."""
        return "public"
    
    def _protected_method(self):
        """A protected method."""
        return "protected"
    
    def __private_method(self):
        """A private method."""
        return "private"
`;

      const chunks = await parser.splitText(pythonCode);
      
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
      
      // Check hierarchical paths
      const serviceChunk = chunks.find(chunk => 
        chunk.section?.path.includes("Service")
      );
      expect(serviceChunk).toBeDefined();
      expect(serviceChunk?.section?.level).toBeGreaterThan(0);
      
      // Methods should have hierarchical paths under the class
      const methodChunk = chunks.find(chunk => 
        chunk.section?.path.includes("public_method")
      );
      expect(methodChunk).toBeDefined();
      if (methodChunk?.section?.path) {
        expect(methodChunk.section.path).toContain("Service");
        expect(methodChunk.section.path).toContain("public_method");
      }
    });

    it("should handle empty or invalid Python code gracefully", async () => {
      // Empty code
      let chunks = await parser.splitText("");
      expect(chunks).toEqual([]);
      
      // Whitespace only
      chunks = await parser.splitText("   \n\n  \t  ");
      expect(chunks).toEqual([]);
      
      // Invalid syntax should not crash
      chunks = await parser.splitText("def invalid syntax here");
      expect(chunks).toBeDefined();
    });
  });

  describe("chunk content validation", () => {
    it("should include docstrings in chunk content when enabled", async () => {
      const parserWithDocs = new PythonParser({ includeDocumentation: true });
      
      const pythonCode = `
def greet(name):
    """Return a greeting message."""
    return f"Hello, {name}!"
`;

      const chunks = await parserWithDocs.splitText(pythonCode);
      const greetChunk = chunks.find(chunk => 
        chunk.section?.path.includes("greet")
      );
      
      expect(greetChunk).toBeDefined();
      expect(greetChunk?.content).toContain("Return a greeting message");
    });

    it("should exclude docstrings when documentation is disabled", async () => {
      const parserWithoutDocs = new PythonParser({ includeDocumentation: false });
      
      const pythonCode = `
def greet(name):
    """Return a greeting message."""
    return f"Hello, {name}!"
`;

      const chunks = await parserWithoutDocs.splitText(pythonCode);
      const greetChunk = chunks.find(chunk => 
        chunk.section?.path.includes("greet")
      );
      
      expect(greetChunk).toBeDefined();
      // The docstring is still in the source code, but not prepended as documentation
      // We just check that it doesn't get duplicated with documentation prepending
      expect(greetChunk?.content).toContain("def greet(name):");
      expect(greetChunk?.content).toContain('"""Return a greeting message."""');
      // Ensure it's not duplicated (no prepended documentation)
      const lines = greetChunk?.content.split('\n') || [];
      const docstringLines = lines.filter(line => line.includes('Return a greeting message'));
      expect(docstringLines.length).toBe(1); // Only once, in the source code
    });
  });
});