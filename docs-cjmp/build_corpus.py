#!/usr/bin/env python3
"""Build the per-unit cj-ui-docs corpus for pyramid-aware retrieval.

Reads the pyramid at <repo>/skills/cj-ui-docs (source files untouched) and
emits one markdown file per retrieval unit into <out>/cj-ui-docs/:

  index.md            L1  routing index
  cases/*.md          L2  one file per case, with a generated API digest block
  api/**/**.md        L3  copied verbatim

Every unit gets front-matter: layer, topic, api_names, keywords. The digest
block (between <!--digest:start--> and <!--digest:end-->) lists each section's
heading, chained-call signature and linked API ids; the server's card mode
returns exactly this block instead of full content.
"""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

API_LINE_RE = re.compile(r"完整 API：\[(.+?)\]\s*$", re.M)
API_LINK_RE = re.compile(r"\[([a-z0-9-]+)\]\(")
CHAIN_RE = re.compile(r"\.\s*([a-zA-Z][A-Za-z0-9]*)\s*(?:\(|\{)")
HEADING_RE = re.compile(r"^## (.+?) \{#([a-z0-9-]+)\}", re.M)
FM_API_LINK_RE = re.compile(r"\[([a-z0-9-]+)\]\(\.\./api/")


def section_digest(sec: str) -> str:
    """One digest line for a `## ... {#anchor}` section."""
    m = re.match(r"## (.+?) \{#([a-z0-9-]+)\}", sec)
    if not m:
        return ""
    title, anchor = m.group(1), m.group(2)
    am = API_LINE_RE.search(sec)
    api_ids = API_LINK_RE.findall(am.group(1)) if am else []
    # 链式调用签名:首个代码块内主组件的调用链(去重,保序,≤10 个)
    chains: list[str] = []
    for call in CHAIN_RE.findall(sec):
        if call not in chains:
            chains.append(call)
        if len(chains) >= 10:
            break
    sig = " ".join(f".{c}()" for c in chains)
    api_part = (" | API: " + ", ".join(api_ids)) if api_ids else ""
    return f"- {title} `{{#{anchor}}}`: {sig}{api_part}"


def front_matter(layer: str, topic: str, api_names: list[str], keywords: list[str]) -> str:
    def fmt(vals: list[str]) -> str:
        return "[" + ", ".join(vals) + "]"

    lines = ["---", f"layer: {layer}", f"topic: {topic}"]
    if api_names:
        lines.append(f"api_names: {fmt(api_names[:24])}")
    if keywords:
        lines.append(f"keywords: {fmt(keywords[:16])}")
    lines.append("---")
    return "\n".join(lines)


def build_case(src: Path, out_dir: Path) -> None:
    text = src.read_text(encoding="utf-8")
    body = re.sub(r"\A^# .*\n+", "", text, count=1)
    title_m = re.match(r"# (.+)", text)
    title = title_m.group(1).strip() if title_m else src.stem

    secs = [s for s in re.split(r"\n(?=## )", body) if s.startswith("## ")]
    digest_lines = [section_digest(s) for s in secs]
    digest_lines = [d for d in digest_lines if d]
    api_names = sorted({a for s in secs for a in FM_API_LINK_RE.findall(s)})
    keywords = sorted({w for s in secs for w in re.findall(r"[A-Z][A-Za-z0-9@.]*|@[A-Z][A-Za-z]+", s.split("\n", 1)[0])})

    content = "\n".join([
        front_matter("L2", title, api_names, keywords),
        "",
        f"# {title} (L2 case)",
        "",
        "<!--digest:start-->",
        "## API 摘要",
        *digest_lines,
        "<!--digest:end-->",
        "",
        body.rstrip(),
        "",
    ])
    (out_dir / "cases" / src.name).write_text(content, encoding="utf-8")


def build_api(src: Path, skill_root: Path, out_dir: Path) -> None:
    text = src.read_text(encoding="utf-8")
    rel = src.relative_to(skill_root / "api")
    title_m = re.match(r"# (.+)", text)
    title = title_m.group(1).strip() if title_m else src.stem
    names = sorted(set(re.findall(r"`([A-Za-z][A-Za-z0-9_.]{2,})`", text[:2000])))
    content = "\n".join([
        front_matter("L3", title, names, []),
        "",
        text.rstrip(),
        "",
    ])
    dest = out_dir / "api" / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding="utf-8")


def build_index(skill_root: Path, out_dir: Path) -> None:
    src = skill_root / "index.md"
    text = src.read_text(encoding="utf-8")
    content = "\n".join([
        front_matter("L1", "cj-ui-docs 索引", [], ["index", "routing"]),
        "",
        text.rstrip(),
        "",
    ])
    (out_dir / "index.md").write_text(content, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill-root", type=Path, required=True, help="skills/cj-ui-docs 目录")
    ap.add_argument("--out", type=Path, required=True, help="语料输出目录(将创建 <out>/cj-ui-docs)")
    args = ap.parse_args()

    root = args.skill_root
    out = args.out / "cj-ui-docs"
    if out.exists():
        shutil.rmtree(out)
    (out / "cases").mkdir(parents=True)

    build_index(root, out)
    cases = sorted((root / "cases").glob("[0-9]*.md"))
    for c in cases:
        build_case(c, out)
    apis = list((root / "api").rglob("*.md"))
    for a in apis:
        build_api(a, root, out)

    n_cases = len(cases)
    n_api = len(apis)
    total_chars = sum(p.stat().st_size for p in out.rglob("*.md"))
    print(f"corpus: {out}")
    print(f"units: 1 L1 + {n_cases} L2 + {n_api} L3 = {1 + n_cases + n_api} files, {total_chars/1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
