# Base stage with build dependencies
FROM node:22-slim AS base

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

# Install production dependencies (with native modules built for target platform)
# RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist

# Set data directory for the container
ENV DOCS_MCP_STORE_PATH=/data

# Define volumes
VOLUME /data

# Expose the default port of the application
EXPOSE 6280
ENV PORT=6280
ENV HOST=0.0.0.0

# Set the command to run the application
ENTRYPOINT ["node", "--enable-source-maps", "dist/index.js"]
