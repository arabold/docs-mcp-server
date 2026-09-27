import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite configuration for building the React admin dashboard SPA.
// The app lives under src/web/client and builds to the project-root `public/`
// directory so a single Fastify static handler can serve both the SPA shell
// and the existing favicon/manifest files untouched by this build.
export default defineConfig({
  root: path.resolve(__dirname, "src/web/client"),
  // Relative asset URLs: the server injects <base href> for the public URL's
  // path at serve time, so one build works at the root and under any path.
  base: "./",
  // Disable Vite's public-dir copy step. The favicons/manifest.json this build
  // serves already live in the output dir (public/), so there's nothing to
  // copy — and pointing publicDir at outDir triggers a warning + copy ambiguity.
  publicDir: false,
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
