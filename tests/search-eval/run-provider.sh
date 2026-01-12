#!/bin/bash
set -e
# Ensure we are in the directory of this script (tests/search-eval)
cd "$(dirname "$0")"

# Execute the provider script, passing all arguments
# We use npx from the project root (../../)
npx vite-node ../../src/tools/search-provider.ts "$@"
