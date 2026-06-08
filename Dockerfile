# Base stage with build dependencies
FROM node:22-trixie-slim AS base

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, tree-sitter, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

# Build stage
FROM base AS builder

# Accept build argument for PostHog API key
ARG POSTHOG_API_KEY
ENV POSTHOG_API_KEY=$POSTHOG_API_KEY

# Copy package files (root + workspaces so `npm ci` can link the companion package)
COPY package*.json ./
COPY packages/transformers/package.json ./packages/transformers/package.json

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM base AS production

# Set environment variables for Playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install Chromium from apt-get
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  chromium \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and database
COPY package*.json .
COPY db db

# Copy built files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist
# Include the built Transformers.js companion package so the workspace symlink in
# node_modules resolves and local (offline) embeddings work out of the box.
COPY --from=builder /app/packages ./packages

# Set data directory for the container
ENV DOCS_MCP_STORE_PATH=/data
ENV XDG_CONFIG_HOME=/config
# Cache directory for Transformers.js models (downloaded on first use).
ENV TRANSFORMERS_CACHE=/models

# Create the writable runtime directories and hand ownership to the
# unprivileged `node` user that ships with the base image (uid 1000).
# `/app` is intentionally left root-owned so the runtime user cannot
# tamper with code or `node_modules` if it is ever compromised.
RUN mkdir -p /data /config /models \
  && chown node:node /data /config /models

# Define volumes
VOLUME /data
VOLUME /config
VOLUME /models

# Expose the default port of the application
EXPOSE 6280
ENV PORT=6280
ENV HOST=0.0.0.0

# Drop privileges before running the app. Named Docker volumes inherit
# this ownership automatically; if you bind-mount a host directory onto
# /data or /config instead, it must be writable by uid 1000 — e.g.
# `chown 1000:1000 ./data` or `docker run --user "$(id -u):$(id -g)"`.
USER node

# Set the command to run the application
ENTRYPOINT ["node", "--enable-source-maps", "dist/index.js"]
