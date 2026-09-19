#!/usr/bin/env python3
"""Validate the shared static contract of a fixed-library lib-* skill."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REQUIRED_TEXT = (
    "## Определить область",
    "## Найти подтверждение",
    "## Сформировать ответ",
    "limit=5",
    "limit=10",
    "Абсолютный предел",
    "После третьего поиска остановись",
    "До ответа не вызывай инструменты",
    "Никогда не вызывай",
    "## По документации",
    "### 1.",
    "[Источник]",
    " | ",
    "## Выводы и рекомендации",
    "Snapshot date",
    "undefined",
    "сырые ответы MCP",
    "Даже при недоступности MCP",
    "[Использованы библиотеки: нет]",
)


def validate(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    skill_file = skill_dir / "SKILL.md"
    agent_file = skill_dir / "agents" / "openai.yaml"
    if not skill_file.is_file():
        return ["SKILL.md not found"]
    if not agent_file.is_file():
        errors.append("agents/openai.yaml not found")

    text = skill_file.read_text(encoding="utf-8")
    name_match = re.search(r"^name:\s*(lib-[a-z0-9-]+)\s*$", text, re.MULTILINE)
    if not name_match:
        errors.append("frontmatter must contain a lib-* name")

    for required in REQUIRED_TEXT:
        if required not in text:
            errors.append(f"missing contract text: {required}")

    library_matches = set(re.findall(r'library="([a-z0-9-]+)"', text))
    footer_matches = set(re.findall(r"\[Использованы библиотеки: ([a-z0-9-]+)\]", text))
    if len(library_matches) != 1:
        errors.append("skill must declare exactly one fixed library")
    if footer_matches != library_matches:
        errors.append("footer library must equal the fixed search library")

    if "не более двух" not in text:
        errors.append("missing two-refinement limit")
    if "литерал `[Источник]` используй ровно один раз" not in text:
        errors.append("missing one-source-marker rule")
    if "Никогда не повторяй `[Источник]` после `|`" not in text:
        errors.append("missing repeated source marker prohibition")
    if "каждый фрагмент по обе стороны разделителя" not in text:
        errors.append("missing complete multi-source tuple rule")
    if "не показывай `file://`" not in text:
        errors.append("missing internal file URL suppression rule")
    if "последней строкой без текста после неё" not in text.lower():
        errors.append("missing final-footer rule")
    if "без поясняющей фразы" not in text:
        errors.append("missing archive-only source rule")
    if "несовместим" not in text:
        errors.append("missing incompatible-version rule")
    if "?" in text:
        errors.append("concrete or example questions are forbidden in SKILL.md")

    if agent_file.is_file():
        agent_text = agent_file.read_text(encoding="utf-8")
        if 'value: "lib-docs"' not in agent_text:
            errors.append("openai.yaml must declare the lib-docs MCP dependency")
        if "allow_implicit_invocation: true" not in agent_text:
            errors.append("openai.yaml must allow implicit invocation")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate_library_skill.py PATH", file=sys.stderr)
        return 2
    errors = validate(Path(sys.argv[1]))
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print("PASS: library skill contract is valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
