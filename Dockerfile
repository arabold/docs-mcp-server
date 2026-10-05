# Share Bun's executable with the build stage and use the official latest
# runtime image for the final image.
FROM oven/bun:latest AS bun

# Base stage with build dependencies
FROM node:22-trixie-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Install build dependencies for native modules (tree-sitter, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

# Build stage
FROM base AS builder

# tree-sitter's node-gyp-build fallback uses Node's global npm-bundled node-gyp.
ENV NODE_PATH=/usr/local/lib/node_modules/npm/node_modules

# Accept build argument for PostHog API key
ARG POSTHOG_API_KEY
ENV POSTHOG_API_KEY=$POSTHOG_API_KEY

# Copy Bun package files
COPY package.json bun.lock ./

# Install all dependencies (including dev dependencies for building)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN bun run build

# Production stage
FROM oven/bun:latest AS production

# Set environment variables for Playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install Chromium from apt-get
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  chromium \
  && rm -rf /var/lib/apt/lists/*

# Copy Bun package files and database
COPY package.json bun.lock .
COPY db db

# Copy built files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist

# Set data directory for the container
ENV DOCS_MCP_STORE_PATH=/data
ENV XDG_CONFIG_HOME=/config

# Create the writable runtime directories and hand ownership to Bun's
# unprivileged `bun` user (uid 1000).
# `/app` is intentionally left root-owned so the runtime user cannot
# tamper with code or `node_modules` if it is ever compromised.
RUN mkdir -p /data /config \
  && chown bun:bun /data /config

# Define volumes
VOLUME /data
VOLUME /config

# Expose the default port of the application
EXPOSE 6280
ENV PORT=6280
ENV HOST=0.0.0.0

# Drop privileges before running the app. Named Docker volumes inherit
# this ownership automatically; if you bind-mount a host directory onto
# /data or /config instead, it must be writable by uid 1000 — e.g.
# `chown 1000:1000 ./data` or `docker run --user "$(id -u):$(id -g)"`.
USER bun

# Set the command to run the application
ENTRYPOINT ["bun", "dist/index.js"]
