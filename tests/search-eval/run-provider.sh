#!/bin/bash
# Exec-provider shim invoked by promptfoo. Runs the TypeScript search provider
# under Bun and prints exactly the JSON line the provider emits on stdout.
#
# Why we pin Bun explicitly:
#   When promptfoo (a Node process) spawns this bash script, the child shell
#   re-initialises PATH from /etc/profile and ~/.bashrc — which on machines
#   using version managers may not include Bun. We sidestep PATH entirely by
#   accepting the orchestrator's Bun binary path through the env (set by
#   run.ts).

set -euo pipefail
cd "$(dirname "$0")"

# Path to the Bun binary that ran the orchestrator. Set by run.ts.
# Fallback to a bare `bun` for ad-hoc invocations from the user's shell.
BUN_BIN="${DOCS_EVAL_BUN:-bun}"

# Use temp files for stdout/stderr instead of command substitution. Bash 3.2
# (the macOS-shipped /bin/bash that runs this shebang) silently truncates
# $(...) at 64KB, which broke when the new scraper started returning full
# markdown chunks — React queries produced ~66KB of provider JSON and the
# truncation lost the JSON's closing brace, leaving sed with no match and
# stdout empty. Redirecting straight to a file sidesteps that limit.
TMP_STDOUT=$(mktemp)
TMP_STDERR=$(mktemp)
# shellcheck disable=SC2064
trap "rm -f '$TMP_STDOUT' '$TMP_STDERR'" EXIT

if "$BUN_BIN" ../../src/tools/search-provider.ts "$@" \
    > "$TMP_STDOUT" 2> "$TMP_STDERR"; then
  sed -n '/^{.*}$/p' "$TMP_STDOUT"
else
  rc=$?
  echo "run-provider.sh: Bun exited $rc" >&2
  echo "  BUN_BIN=$BUN_BIN" >&2
  echo "----- stderr -----" >&2
  cat "$TMP_STDERR" >&2
  echo "----- stdout (raw) -----" >&2
  cat "$TMP_STDOUT" >&2
  exit "$rc"
fi
