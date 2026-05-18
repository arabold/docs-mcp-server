#!/bin/bash
# Context7 exec-provider shim invoked by promptfoo.
#
# Pure Node + https — no vite-node, no docs-mcp-server, no better-sqlite3.
# Provider cold-start is ~100ms vs ~5s for the local provider.

set -euo pipefail
cd "$(dirname "$0")"

NODE_BIN="${DOCS_EVAL_NODE:-node}"

# Use temp files instead of $(command) — bash 3.2 (macOS /bin/bash) silently
# truncates command substitution at 64KB. See the matching note in
# run-provider.sh for the full story; relevant here once Context7 chunks for
# large docs (e.g. a 60-snippet React response) pass that threshold.
TMP_STDOUT=$(mktemp)
TMP_STDERR=$(mktemp)
# shellcheck disable=SC2064
trap "rm -f '$TMP_STDOUT' '$TMP_STDERR'" EXIT

if "$NODE_BIN" ./context7-provider.cjs "$@" > "$TMP_STDOUT" 2> "$TMP_STDERR"; then
  # Provider emits a single JSON line; pass it through unchanged.
  sed -n '/^{.*}$/p' "$TMP_STDOUT"
else
  rc=$?
  echo "run-context7-provider.sh: node exited $rc" >&2
  echo "  NODE_BIN=$NODE_BIN" >&2
  echo "----- stderr -----" >&2
  cat "$TMP_STDERR" >&2
  echo "----- stdout (raw) -----" >&2
  cat "$TMP_STDOUT" >&2
  exit "$rc"
fi
