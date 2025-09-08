# Build stage
FROM node:22-slim AS builder

# Accept build argument for PostHog API key
ARG POSTHOG_API_KEY
ENV POSTHOG_API_KEY=$POSTHOG_API_KEY

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json .
COPY db            db

# Install production dependencies only
RUN npm ci --omit=dev

# Install system Chromium and required dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /tmp/* \
  && CHROMIUM_PATH=$(command -v chromium || command -v chromium-browser) \
  && if [ -z "$CHROMIUM_PATH" ]; then echo "Chromium executable not found!" && exit 1; fi \
  && if [ "$CHROMIUM_PATH" != "/usr/bin/chromium" ]; then echo "Unexpected Chromium path: $CHROMIUM_PATH" && exit 1; fi \
  && echo "Chromium installed at $CHROMIUM_PATH"

# Set Playwright to use system Chromium (hardcoded path, as ENV cannot use shell vars)
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Set data directory for the container
ENV DOCS_MCP_STORE_PATH=/data

# Define volumes
VOLUME /data

# Expose the default port of the application
EXPOSE 6280

# Set the command to run the application
ENTRYPOINT ["node", "dist/index.js"]
