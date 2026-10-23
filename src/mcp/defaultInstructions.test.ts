import { describe, expect, it } from "vitest";
import { buildDefaultInstructions } from "./defaultInstructions";

describe("buildDefaultInstructions", () => {
  it("names the indexing tools only when the server can index", () => {
    const cases = [
      {
        mode: "normal",
        readOnly: false,
        present: ["`scrape_docs`", "`get_job_info`"],
        absent: ["cannot index new documentation"],
      },
      {
        mode: "read-only",
        readOnly: true,
        present: ["cannot index new documentation"],
        absent: ["`scrape_docs`", "`get_job_info`"],
      },
    ];

    for (const { mode, readOnly, present, absent } of cases) {
      const text = buildDefaultInstructions(readOnly);
      for (const phrase of present) expect.soft(text, mode).toContain(phrase);
      for (const phrase of absent) expect.soft(text, mode).not.toContain(phrase);
    }
  });
});
