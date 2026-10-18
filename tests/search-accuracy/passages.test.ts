import { describe, expect, it } from "vitest";
import { isPage, matchPassage, normalizeWords } from "./passages";

describe("matchPassage", () => {
  it("ignores Markdown links, emphasis, inline code, case and line breaks", () => {
    const content =
      "Call [`useRef`](/reference/react/useRef) at the **top level**\nof your component to _declare_ a ref.";

    expect(matchPassage(content, "call useRef at the top level of your component")).toBe(
      "whole",
    );
  });

  it("does not match a passage the content lacks", () => {
    expect(
      matchPassage("State lets a component remember.", "refs do not trigger renders"),
    ).toBeNull();
  });

  it("does not match words that only appear out of order", () => {
    expect(matchPassage("level top the at", "at the top level")).toBeNull();
  });

  it("counts a chunk holding at least half of a passage the splitter cut", () => {
    const passage = "one two three four five six seven eight";
    const firstChunk = "intro text one two three four five";
    const secondChunk = "six seven eight and more";

    expect(matchPassage(firstChunk, passage)).toBe("split");
    expect(matchPassage(secondChunk, passage)).toBeNull();
  });

  it("matches whole words only", () => {
    expect(matchPassage("the reference is here", "ref")).toBeNull();
  });
});

describe("normalizeWords", () => {
  it("drops the targets of escaped reference links", () => {
    expect(
      normalizeWords(
        "Use \\[`computed_field`\\]\\[pydantic.fields.computed_field\\] here",
      ),
    ).toEqual(["use", "computed", "field", "here"]);
  });

  it("keeps link and image text but drops their targets", () => {
    expect(normalizeWords("See ![diagram](a.png) and [the docs][ref].")).toEqual([
      "see",
      "diagram",
      "and",
      "the",
      "docs",
    ]);
  });
});

describe("isPage", () => {
  it("matches a file URL by the page path under its root", () => {
    const url = "file:///cache/react%40abc/src/content/reference/react/useRef.md";

    expect(isPage(url, "reference/react/useRef.md")).toBe(true);
    expect(isPage(url, "react/useState.md")).toBe(false);
    expect(isPage(url, "Ref.md")).toBe(false);
  });
});
