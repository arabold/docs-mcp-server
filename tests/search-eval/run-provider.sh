#!/bin/bash
# Exec-provider shim invoked by promptfoo. Runs the TypeScript search provider
# under vite-node and prints exactly the JSON line the provider emits on stdout.
#
# Why we pin Node explicitly:
#   When promptfoo (a Node process) spawns this bash script, the child shell
#   re-initialises PATH from /etc/profile and ~/.bashrc — which on machines
#   using nvm typically points at a *different* Node version than the one
#   running the orchestrator. The result was a better-sqlite3 ABI mismatch
#   on every query. We sidestep PATH entirely by accepting the orchestrator's
#   Node binary path through the env (set by run.ts) and invoking vite-node's
#   CLI entry point directly.

set -euo pipefail
cd "$(dirname "$0")"

# Path to the Node binary that ran the orchestrator. Set by run.ts.
# Fallback to a bare `node` for ad-hoc invocations from the user's shell.
NODE_BIN="${DOCS_EVAL_NODE:-node}"
# Absolute path to vite-node's CLI entry. Set by run.ts.
# Fallback resolves it from the repo's node_modules.
VITE_NODE_CLI="${DOCS_EVAL_VITE_NODE:-$PWD/../../node_modules/vite-node/dist/cli.mjs}"

TMP_STDERR=$(mktemp)
# shellcheck disable=SC2064
trap "rm -f '$TMP_STDERR'" EXIT

if STDOUT=$("$NODE_BIN" "$VITE_NODE_CLI" ../../src/tools/search-provider.ts "$@" 2>"$TMP_STDERR"); then
  echo "$STDOUT" | sed -n '/^{.*}$/p'
else
  rc=$?
  echo "run-provider.sh: vite-node exited $rc" >&2
  echo "  NODE_BIN=$NODE_BIN" >&2
  echo "  VITE_NODE_CLI=$VITE_NODE_CLI" >&2
  echo "----- stderr -----" >&2
  cat "$TMP_STDERR" >&2
  echo "----- stdout (raw) -----" >&2
  echo "$STDOUT" >&2
  exit "$rc"
fi
