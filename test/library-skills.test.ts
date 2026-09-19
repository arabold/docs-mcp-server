import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const librarySkills = {
  "lib-nifi": "nifi",
  "lib-pm2-it": "pm2-it",
  "lib-postgresql": "postgresql",
  "lib-sap-sf-odata": "sap-sf-odata",
} as const;

function skillFile(name: string, file = "SKILL.md") {
  return readFileSync(resolve(root, "skills", name, file), "utf8");
}

describe.each(Object.entries(librarySkills))("%s", (skill, library) => {
  const text = skillFile(skill);
  const agent = skillFile(skill, "agents/openai.yaml");

  it("keeps one fixed library and the matching final footer", () => {
    const libraries = [...text.matchAll(/library="([a-z0-9-]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(libraries)).toEqual(new Set([library]));
    expect(text).toContain(`[Использованы библиотеки: ${library}]`);
    expect(text.toLowerCase()).toContain("последней строкой без текста после неё");
  });

  it("uses the shared ambiguity and search budget contract", () => {
    expect(text).toContain("До ответа не вызывай инструменты");
    expect(text).toContain("начальный `search_docs` выполни с `limit=5`");
    expect(text).toContain("не более двух раз");
    expect(text).toContain("Абсолютный предел");
    expect(text).toContain("После третьего поиска остановись");
    expect(text).toContain("только `limit=5` или `limit=10`");
    expect(text).toContain("Никогда не вызывай");
  });

  it("uses the shared grounded answer format", () => {
    expect(text).toContain("## По документации");
    expect(text).toContain("`### 1.`, `### 2.`");
    expect(text).toContain("литерал `[Источник]` используй ровно один раз");
    expect(text).toContain("Никогда не повторяй `[Источник]` после `|`");
    expect(text).toContain("через ` | `");
    expect(text).toContain("каждый фрагмент по обе стороны разделителя");
    expect(text).toContain("Не ставь после `|` отдельный URL или раздел");
    expect(text).toContain("## Выводы и рекомендации");
    expect(text).toContain("не показывай `file://`");
    expect(text).toContain("Snapshot date");
    expect(text).toContain("undefined");
    expect(text).toContain("Даже при недоступности MCP");
    expect(text).toContain("помести состояние в `### 1.`");
    expect(text).toContain("без поясняющей фразы");
    expect(text).toContain("[Использованы библиотеки: нет]");
  });

  it("contains routing keywords but no concrete example questions", () => {
    expect(text).not.toContain("?");
    expect(text).not.toMatch(/пример(?:ы)? вопрос/iu);
    expect(text).not.toMatch(/пользователь спрашивает/iu);
  });

  it("declares the lib-docs MCP dependency", () => {
    expect(agent).toContain('value: "lib-docs"');
    expect(agent).toContain("allow_implicit_invocation: true");
  });
});

describe("lib-skill-creation", () => {
  const text = skillFile("lib-skill-creation");
  const agent = skillFile("lib-skill-creation", "agents/openai.yaml");
  const contract = skillFile(
    "lib-skill-creation",
    "references/library-skill-contract.md",
  );
  const validator = skillFile(
    "lib-skill-creation",
    "scripts/validate_library_skill.py",
  );

  it("requires initialization, static validation, and blind forward tests", () => {
    expect(text).toContain("skill-creator/scripts/init_skill.py");
    expect(text).toContain("quick_validate.py");
    expect(text).toContain("validate_library_skill.py");
    expect(text).toContain("blind forward-тесты");
    expect(text).toContain("свежих агентских контекстах");
  });

  it("forbids embedded questions and carries the full contract", () => {
    expect(text).toContain(
      "Не добавляй конкретные пользовательские вопросы, демонстрационные запросы",
    );
    expect(contract).toContain("Абсолютный максимум — три `search_docs`");
    expect(contract).toContain("Литерал `[Источник]` появляется ровно один раз");
    expect(contract).toContain("[Использованы библиотеки: TECHNICAL_NAME]");
    expect(validator).toContain("def validate(skill_dir: Path)");
  });

  it("can inspect the target documentation library", () => {
    expect(agent).toContain('value: "lib-docs"');
    expect(agent).toContain("allow_implicit_invocation: true");
  });
});

describe("lib-sap-sf-odata ambiguity gate", () => {
  const text = skillFile("lib-sap-sf-odata");

  it("does not infer SuccessFactors from skill activation alone", () => {
    expect(text).toContain("Не считай путь к этому `SKILL.md`");
    expect(text).toContain("выбор библиотеки не достиг 100% определённости");
    expect(text).toContain("Выведи только вопрос");
    expect(text).toContain("не делай предположение о SuccessFactors");
    expect(text).toContain("Это правило имеет приоритет над поиском");
  });
});
