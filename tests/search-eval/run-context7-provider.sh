#!/bin/bash
# Context7 exec-provider shim invoked by promptfoo.
#
# Pure Node + https — no vite-node, no docs-mcp-server, no better-sqlite3.
# Provider cold-start is ~100ms vs ~5s for the local provider.

set -euo pipefail
cd "$(dirname "$0")"

NODE_BIN="${DOCS_EVAL_NODE:-node}"

TMP_STDERR=$(mktemp)
# shellcheck disable=SC2064
trap "rm -f '$TMP_STDERR'" EXIT

if STDOUT=$("$NODE_BIN" ./context7-provider.cjs "$@" 2>"$TMP_STDERR"); then
  # Provider emits a single JSON line; pass it through unchanged.
  echo "$STDOUT" | sed -n '/^{.*}$/p'
else
  rc=$?
  echo "run-context7-provider.sh: node exited $rc" >&2
  echo "  NODE_BIN=$NODE_BIN" >&2
  echo "----- stderr -----" >&2
  cat "$TMP_STDERR" >&2
  echo "----- stdout (raw) -----" >&2
  echo "$STDOUT" >&2
  exit "$rc"
fi
