import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";
import packageJson from "./package.json";

export default defineConfig({
  publicDir: false,
  define: {
    __POSTHOG_API_KEY__: JSON.stringify(""),
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: "mcpb-dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: { index: path.resolve(__dirname, "src/mcpb.ts") },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((moduleName) => `node:${moduleName}`),
        "better-sqlite3",
        "sqlite-vec",
      ],
      output: { entryFileNames: "[name].js" },
    },
    target: "node22",
    ssr: true,
  },
});
