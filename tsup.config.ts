import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/cli.ts"],
  format: ["esm"], // Build only ESM format
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
});
