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

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Drop the musl-linked native builds. npm selects platform packages by `os`
# and `cpu`; it only filters on `libc` when the lockfile records that field,
# which npm 10 does not write. Both the glibc and musl variants therefore get
# installed, and on this Debian base the musl ones can never load. Pruning
# them keeps ~190 MB of dead binaries (over half of it `@xberg-io/xberg`)
# out of the runtime image.
RUN find node_modules -maxdepth 3 -type d -name '*-linux-*-musl' -prune -exec rm -rf {} +

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

# Set data directory for the container
ENV DOCS_MCP_STORE_PATH=/data
ENV XDG_CONFIG_HOME=/config

# Create writable runtime directories for both the default `node` user and
# platforms such as OpenShift that assign an arbitrary uid in group 0. `g=u`
# mirrors owner permissions onto the root group without making these paths
# world-writable. `/app` stays root-owned and non-writable at runtime.
RUN mkdir -p /data /config \
  && chgrp -R 0 /data /config \
  && chmod -R g=u /data /config

# Define volumes
VOLUME /data
VOLUME /config

# Expose the default port of the application
EXPOSE 6280
ENV PORT=6280
ENV HOST=0.0.0.0

# Use a numeric non-root default so Kubernetes can verify `runAsNonRoot`.
# OpenShift and other runtimes may override it with an arbitrary uid. Mounted
# volumes must grant that uid or one of its supplemental groups write access.
USER 1000

# Set the command to run the application
ENTRYPOINT ["sh", "-c", "umask 0002; exec node --enable-source-maps dist/index.js \"$@\"", "--"]
