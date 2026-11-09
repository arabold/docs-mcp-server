import { describe, expect, it } from "vitest";
import {
  checkCoverage,
  type GoldenQuery,
  GoldenSetError,
  parseGoldenSet,
  QUERY_STYLES,
} from "./golden";

const LIBRARIES = ["react", "vite"];

function query(overrides: Partial<GoldenQuery> = {}): GoldenQuery {
  return {
    id: "react-001",
    library: "react",
    query: "keep a value between renders",
    intent: "how-to",
    style: "question",
    passages: [
      { page: "reference/react/useRef.md", text: "useRef is a React Hook", grade: 3 },
    ],
    ...overrides,
  };
}

function problemsOf(raw: unknown): string[] {
  try {
    parseGoldenSet(raw, LIBRARIES, "golden.yaml");
  } catch (error) {
    if (error instanceof GoldenSetError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseGoldenSet", () => {
  it("accepts a well-formed entry", () => {
    const set = parseGoldenSet(
      { status: "draft", queries: [query()] },
      LIBRARIES,
      "golden.yaml",
    );

    expect(set.queries).toHaveLength(1);
    expect(set.status).toBe("draft");
  });

  it("rejects a query without passages, naming it", () => {
    expect(problemsOf({ queries: [query({ passages: [] })] })).toEqual([
      "react-001: needs at least one passage",
    ]);
  });

  it("rejects a grade outside 1 to 3", () => {
    const passages = [{ page: "a.md", text: "x", grade: 4 as 3 }];

    expect(problemsOf({ queries: [query({ passages })] })).toEqual([
      'react-001 passages[0]: "grade" must be 1, 2 or 3',
    ]);
  });

  it("rejects unknown libraries, styles and intents, and duplicate ids", () => {
    const problems = problemsOf({
      queries: [
        query({ library: "angular" }),
        query({ style: "shouting" as "question", intent: "gossip" as "how-to" }),
      ],
    });

    expect(problems).toEqual([
      'react-001: "library" must be one of react, vite',
      "react-001: duplicate id",
      `react-001: "intent" must be one of api-lookup, how-to, conceptual, comparison, troubleshooting`,
      `react-001: "style" must be one of ${QUERY_STYLES.join(", ")}`,
    ]);
  });
});

describe("checkCoverage", () => {
  const library = (index: number) => ["react", "vite", "fastapi", "pydantic"][index % 4];
  const style = (index: number) => QUERY_STYLES[index % QUERY_STYLES.length];
  const covered = Array.from({ length: 100 }, (_, index) =>
    query({ id: `q-${index}`, library: library(index), style: style(index) }),
  );

  it("passes a set that meets every rule", () => {
    expect(checkCoverage(covered)).toEqual([]);
  });

  it("names a library above 40% of the queries", () => {
    const skewed = covered.map((entry, index) =>
      index < 60 ? { ...entry, library: "react" } : entry,
    );

    expect(checkCoverage(skewed)).toEqual([
      'library "react" has 70 of 100 queries; at most 40% allowed',
    ]);
  });

  it("names a style below 10% of the queries", () => {
    const questionsOnly = covered.map((entry) => ({
      ...entry,
      style: "question" as const,
    }));

    expect(checkCoverage(questionsOnly)).toContain(
      'style "keywords" has 0 of 100 queries; needs at least 10%',
    );
  });

  it("asks for more queries in a small set", () => {
    expect(checkCoverage(covered.slice(0, 40))).toContain(
      "has 40 queries; needs at least 100",
    );
  });
});
