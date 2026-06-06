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
    '__APP_VERSION__': JSON.stringify(process.env.APP_VERSION || packageJson.version),
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
        // Optional Transformers.js companion package. It is loaded via a dynamic import only
        // when local embeddings are used, and must never be bundled. It is a devDependency
        // (not a runtime dependency) so it is not covered by the dependencies list above.
        /^@arabold\/docs-mcp-server-transformers(\/.*)?$/,
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
    // Map the optional Transformers.js companion to a lightweight stub during tests. The real
    // companion's build output is absent in the test job, and Vitest statically resolves the
    // dynamic import in transformersLoader.ts; the stub keeps resolution working without
    // building or loading the heavy package. (Production externalizes the import instead.)
    alias: {
      "@arabold/docs-mcp-server-transformers": path.resolve(
        __dirname,
        "test/stubs/transformers-companion.ts",
      ),
    },
    testTimeout: 30000, // 30 seconds for network operations
    // Include both unit tests and e2e tests
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "test/**/*.test.ts",
    ],
    // Exclude live e2e tests by default (they can be run manually)
    exclude: ["test/**/*-live-e2e.test.ts"],
    // Use the e2e setup which includes both logger mock and mock server
    setupFiles: ["test/setup-env.ts", "test/setup-e2e.ts"],
    // Suppress stdout/stderr from passing tests. Failed tests still show
    // their output so debugging information is preserved. Set
    // ENABLE_TEST_LOGS=1 (or pass --silent=false) to surface logs for all tests.
    silent: process.env.ENABLE_TEST_LOGS === "1" ? false : "passed-only",
    env: {
      // Silence dotenv v17 "injected env" banners during test runs.
      DOTENV_CONFIG_QUIET: "true",
    },
  },
});
