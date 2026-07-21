import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite configuration for building the React admin dashboard SPA.
// The app lives under src/web/client and builds to the project-root `public/`
// directory so a single Fastify static handler can serve both the SPA shell
// and the existing favicon/manifest files untouched by this build.
export default defineConfig({
  root: path.resolve(__dirname, "src/web/client"),
  // Point publicDir at the project-root public/ folder (rather than the
  // default `<root>/public`) so favicons and manifest.json already living
  // there are treated as this build's static assets instead of being ignored.
  publicDir: path.resolve(__dirname, "public"),
  plugins: [react()],
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  build: {
    // Output directly into public/ so AppServer's existing static file
    // handler serves index.html and hashed assets without further wiring.
    outDir: path.resolve(__dirname, "public"),
    assetsDir: "assets",
    // Never wipe public/ - it already holds favicons and manifest.json that
    // this build does not (re)generate.
    emptyOutDir: false,
    sourcemap: true,
    target: "esnext",
  },
});
