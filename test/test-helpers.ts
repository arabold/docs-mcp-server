
import fs from "node:fs";
import path from "node:path";

/**
 * Returns the command and arguments to run the CLI.
 * Prefers the built 'dist/index.js' if available for faster execution.
 * Falls back to Bun's native TypeScript runtime during development.
 */
export function getCliCommand(): { cmd: string; args: string[] } {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const distEntry = path.join(projectRoot, "dist", "index.js");

  // Check if dist/index.js exists
  if (fs.existsSync(distEntry)) {
    return { cmd: "bun", args: [distEntry] };
  }

  // Bun runs TypeScript source files directly.
  const srcEntry = path.join(projectRoot, "src", "index.ts");
  return { cmd: "bun", args: [srcEntry] };
}
