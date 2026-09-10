#!/usr/bin/env python3
"""Offline retrieval eval for the pyramid-aware retrieval protocol.

Runs the docs-mcp-server CLI `search` for every query in eval_set.jsonl against
a store, then reports recall@k and payload size stats.

Golden match rule:
- legacy bundle store: a result matches when its content contains the golden
  section's heading text (the old store serves one URL for the whole pyramid).
- per-unit store: a result matches when its URL contains the golden file path
  (per-unit URLs mirror repo paths).

Usage:
  python3 run_eval.py --store <store-path> [--library cj-ui-docs] [--limit 3]
      [--bin <docs-mcp-server-entry>] [--out results.jsonl]
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_EVAL = HERE / "eval_set.jsonl"

# golden_file -> {anchor: heading_text}; loaded lazily from the pyramid repo
PYRAMID_CASES = None


def load_headings(pyramid_cases_dir: Path) -> dict[str, dict[str, str]]:
    global PYRAMID_CASES
    if PYRAMID_CASES is not None:
        return PYRAMID_CASES
    headings: dict[str, dict[str, str]] = {}
    for f in sorted(pyramid_cases_dir.glob("[0-9]*.md")):
        text = f.read_text(encoding="utf-8")
        per: dict[str, str] = {}
        for m in re.finditer(r"^## (.+?) \{#([a-z0-9-]+)\}", text, re.M):
            per[m.group(2)] = m.group(1)
        headings[f.name] = per
    PYRAMID_CASES = headings
    return headings


def run_one(bin_path: str, store: Path, library: str, query: str, limit: int,
            detail: str = "full") -> list[dict]:
    cmd = [bin_path, "search", library, query, "--store-path", str(store),
           "--limit", str(limit), "--output", "json"]
    if detail == "cards":
        cmd += ["--detail", "cards"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"search failed for {query!r}: {proc.stderr[:200]}")
    out = proc.stdout.strip()
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else data.get("results", [])


def matches(golden_file: str, golden_section: str, result: dict, headings: dict) -> bool:
    from urllib.parse import unquote
    url = unquote(result.get("url", "") + " " + result.get("unitPath", ""))
    content = result.get("content", "")
    if golden_file in url:
        return True
    # 精确埋点:金字塔 case 示例代码自带 .id("case-<anchor>")
    if f"case-{golden_section}" in content:
        return True
    heading = headings.get(golden_file, {}).get(golden_section)
    if heading and heading in content:
        return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--library", default="cj-ui-docs")
    ap.add_argument("--limit", type=int, default=3)
    ap.add_argument("--bin", default=str(Path(__file__).parents[2] / "dist" / "index.js"))
    ap.add_argument("--eval-set", default=str(DEFAULT_EVAL))
    ap.add_argument("--pyramid-cases", default=str(Path.home() / "Desktop/CJMP/VibeCoding/skills/cj-ui-docs/cases"))
    ap.add_argument("--detail", default="full", choices=["full", "cards"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    headings = load_headings(Path(args.pyramid_cases))
    queries = [json.loads(l) for l in open(args.eval_set, encoding="utf-8") if l.strip()]

    stats = {"hit": 0, "miss": 0}
    payloads: list[int] = []
    misses: list[dict] = []
    records = []
    t0 = time.time()
    for i, q in enumerate(queries):
        results = run_one(args.bin, args.store, args.library, q["query"], args.limit, args.detail)
        payload = sum(len(r.get("content", "")) + len(r.get("url", "")) for r in results)
        hit = any(matches(q["golden_file"], q["golden_section"], r, headings) for r in results)
        stats["hit" if hit else "miss"] += 1
        payloads.append(payload)
        rec = {**q, "hit": hit, "payload_chars": payload, "n_results": len(results)}
        records.append(rec)
        if not hit:
            misses.append(rec)
        if (i + 1) % 20 == 0:
            print(f"  {i+1}/{len(queries)}...", file=sys.stderr)

    total = stats["hit"] + stats["miss"]
    payloads.sort()
    med = statistics.median(payloads) if payloads else 0
    p90 = payloads[int(len(payloads) * 0.9)] if payloads else 0
    by_src: dict[str, dict[str, int]] = {}
    for r in records:
        s = by_src.setdefault(r.get("src", "?"), {"n": 0, "hit": 0})
        s["n"] += 1
        s["hit"] += 1 if r["hit"] else 0
    summary = {
        "store": str(args.store), "library": args.library, "limit": args.limit, "detail": args.detail,
        "n": total, "recall": round(stats["hit"] / total, 4) if total else 0,
        "recall_by_src": {k: round(v["hit"] / v["n"], 4) for k, v in by_src.items()},
        "payload_median": med, "payload_p90": p90,
        "payload_mean": round(statistics.mean(payloads)) if payloads else 0,
        "elapsed_s": round(time.time() - t0, 1),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.out:
        Path(args.out).write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in records), encoding="utf-8")
        Path(args.out + ".summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if misses:
        print(f"\nmisses ({len(misses)}):", file=sys.stderr)
        for m in misses[:15]:
            print(f"  [{m['golden_file']}#{m['golden_section']}] {m['query']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
