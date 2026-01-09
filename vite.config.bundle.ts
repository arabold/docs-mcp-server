import { defineConfig } from "vitest/config";
import path from 'path';
import fs from 'fs';
import packageJson from "./package.json";

// Native modules that MUST be external because they can't be bundled (contain C++ bindings)
const NATIVE_MODULES = [
  'better-sqlite3',
  'sqlite-vec',
  'playwright', // Playwright installs browsers, best kept external or handled carefully
  'sharp', // If used
  'cpu-features',
  'ssh2',
  'jsdom',
  'cssstyle'
];

export default defineConfig({
  plugins: [
    {
      name: 'preserve-shebang',
      generateBundle(options, bundle) {
        const indexBundle = bundle['index.js'];
        if (indexBundle && indexBundle.type === 'chunk' && indexBundle.code) {
          indexBundle.code = '#!/usr/bin/env node\n' + indexBundle.code;
        }
      },
      writeBundle(options) {
        const indexPath = path.join(options.dir || 'dist-bundle', 'index.js');
        if (fs.existsSync(indexPath)) {
          fs.chmodSync(indexPath, 0o755);
        }
      }
    }
  ],
  define: {
    '__POSTHOG_API_KEY__': JSON.stringify(process.env.POSTHOG_API_KEY || ''),
    '__APP_VERSION__': JSON.stringify(process.env.APP_VERSION || packageJson.version),
    // Fix for some libraries checking NODE_ENV
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    // Prefer node versions of packages
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    conditions: ['node', 'module', 'import', 'require', 'default']
  },
  build: {
    outDir: 'dist-bundle', 
    sourcemap: false, // Save space
    emptyOutDir: true,
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // PROPERLY externalize native modules
      external: [
        /^node:/, 
        ...NATIVE_MODULES
      ],
    },
    target: 'node18', 
    ssr: true, // Required for Node build
  },
  ssr: {
      // FORCE bundling of everything else.
      // This regex says: "Bundle everything" (Vite will still respect rollupOptions.external)
      noExternal: /./
  }
});
