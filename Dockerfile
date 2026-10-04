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
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docs-mcp-entrypoint

# Set data directory for the container
ENV DOCS_MCP_STORE_PATH=/data
ENV XDG_CONFIG_HOME=/config
ENV XDG_DATA_HOME=/data
ENV HOME=/app/.runtime
ENV XDG_CACHE_HOME=/app/.runtime/cache
ENV NPM_CONFIG_CACHE=/app/.runtime/cache/npm
ENV TMPDIR=/tmp

# Use a dedicated runtime account for ordinary container engines. OpenShift may
# replace its uid and gid with arbitrary values, so only the dedicated runtime
# paths are writable by any non-root identity. Application code remains
# root-owned and non-writable.
RUN groupadd --system --gid 10001 docs-mcp \
  && useradd --system --uid 10001 --gid 10001 --home-dir /app/.runtime \
    --no-create-home --shell /usr/sbin/nologin docs-mcp \
  && mkdir -p /data /config /app/.runtime/cache/npm /nonexistent \
  && chown -R docs-mcp:docs-mcp /data /config /app/.runtime /nonexistent \
  && chmod -R g=u /data /config /app/.runtime /nonexistent \
  && chmod -R g+w /data /config /app/.runtime /nonexistent \
  && chmod -R g+rX /data /config /app/.runtime /nonexistent \
  && chmod -R a+rwX /data /config /app/.runtime /nonexistent \
  && chmod -R a+rX /app/dist /app/public /app/db /app/node_modules \
  && chmod 1777 /tmp

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
USER 10001:10001

# Keep execution in the application directory while HOME and all cache writes
# resolve to the dedicated runtime directory.
WORKDIR /app

# Fail the build if the default identity cannot write its runtime paths or can
# modify shipped application code.
RUN test "$(id -u)" = 10001 \
  && test "$(id -g)" = 10001 \
  && for dir in /app/.runtime /app/.runtime/cache /app/.runtime/cache/npm \
      /data /config /nonexistent /tmp; do \
    touch "$dir/.permission-check" && rm "$dir/.permission-check" || exit 1; \
  done \
  && test ! -w /app/dist \
  && test ! -w /app/public \
  && test ! -w /app/db \
  && test ! -w /app/node_modules

# Set the command to run the application
ENTRYPOINT ["/usr/local/bin/docs-mcp-entrypoint"]
