#!/bin/bash
set -e
# Ensure we are in the directory of this script (tests/search-eval)
cd "$(dirname "$0")"

# Execute the provider script and capture all output
# We use sed to extract only the JSON part (from first { to last })
OUTPUT=$(npx vite-node ../../src/tools/search-provider.ts "$@" 2>&1)
echo "$OUTPUT" | sed -n '/^{.*}$/p'
