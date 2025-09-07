import { defineConfig } from "vitest/config";
import path from 'path';
import fs from 'fs';
import packageJson from "./package.json";

export default defineConfig({
  plugins: [
    // Plugin to preserve shebang in the built file
    {
      name: 'preserve-shebang',
      generateBundle(options, bundle) {
        const indexBundle = bundle['index.js'];
        if (indexBundle && indexBundle.type === 'chunk' && indexBundle.code) {
          // Add shebang to the beginning of the file
          indexBundle.code = '#!/usr/bin/env node\n' + indexBundle.code;
        }
      },
      writeBundle(options) {
        // Make the index.js file executable after writing
        const indexPath = path.join(options.dir || 'dist', 'index.js');
        if (fs.existsSync(indexPath)) {
          fs.chmodSync(indexPath, 0o755);
        }
      }
    }
  ],
  define: {
    // Inject environment variables at build time - MUST be set during CI/CD
    '__POSTHOG_API_KEY__': JSON.stringify(process.env.POSTHOG_API_KEY || ''),
  },
  resolve: {
    // Keep existing resolve extensions
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  optimizeDeps: {
    force: true
  },
  build: {
    outDir: 'dist', // Output directory
    sourcemap: true, // Generate sourcemaps
    emptyOutDir: true, // Clean the output directory before build (replaces tsup clean:true)
    lib: {
      // Define entry points using path.resolve for robustness
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
      },
      formats: ['es'], // Output ESM format only
      // Output filename will be based on the entry key (index.js)
      // fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      // Externalize dependencies and node built-ins
      external: [
        /^node:/, // Externalize all node built-ins (e.g., 'node:fs', 'node:path')
        ...Object.keys(packageJson.dependencies || {}),
        // Explicitly externalize potentially problematic packages if needed
        'fingerprint-generator',
        'header-generator',
        'better-sqlite3', // Often needs to be external due to native bindings
        'playwright', // Playwright should definitely be external
        'sqlite-vec', // Likely involves native bindings
      ],
      
      output: {
        // Optional: Configure output further if needed
        // preserveModules: true, // Uncomment if you need to preserve source file structure
        // entryFileNames: '[name].js', // Adjust naming if needed
      },
    },
    // Target Node.js environment based on the version running the build
    target: `node${process.versions.node.split('.')[0]}`,
    ssr: true, // Explicitly mark this as an SSR/Node build
  },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 5000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["test/**/*.test.ts"],
  },
});
