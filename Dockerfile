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
ENV XDG_DATA_HOME=/data
ENV XDG_CACHE_HOME=/app/.cache
ENV NPM_CONFIG_CACHE=/app/.cache/npm
ENV HOME=/app
ENV TMPDIR=/tmp

# Match the nobody ownership model used by LiteLLM's non-root image. The
# default uid owns every application/runtime path, including relative caches
# and the passwd home fallback. Group 0 receives the same access for OpenShift
# arbitrary uids. System binaries remain root-owned; no chmod 777 is needed.
RUN test "$(id -u nobody)" = 65534 \
  && test "$(id -g nobody)" = 65534 \
  && mkdir -p /data /config /app/.cache/npm /nonexistent \
  && chown -R 65534:0 /app /data /config /nonexistent \
  && chmod -R u+rwX /app /data /config /nonexistent \
  && chmod -R g=u /app /data /config /nonexistent \
  && find /app /data /config /nonexistent -type d -exec chmod g+s {} + \
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
USER 65534

# HOME and the working directory are owned by nobody, so both home-relative
# and cwd-relative writes work without root privileges.
WORKDIR /app

# Fail the build if the final runtime identity cannot write its runtime paths.
RUN test "$(id -u)" = 65534 \
  && test "$(id -g)" = 65534 \
  && for dir in /app /app/dist /app/public /app/db /app/node_modules \
      /app/.cache /app/.cache/npm /data /config /nonexistent /tmp; do \
    touch "$dir/.permission-check" && rm "$dir/.permission-check" || exit 1; \
  done

# Set the command to run the application
ENTRYPOINT ["sh", "-c", "umask 0002; exec node --enable-source-maps /app/dist/index.js \"$@\"", "--"]
