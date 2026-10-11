import { describe, expect, it } from "vitest";
import { buildDefaultInstructions } from "./defaultInstructions";

describe("buildDefaultInstructions", () => {
  it("explains how to index a missing library when indexing is available", () => {
    const text = buildDefaultInstructions(false);

    expect(text).toContain("`scrape_docs`");
    expect(text).toContain("`get_job_info`");
  });

  it("leaves out indexing tools and says the server cannot index in read-only mode", () => {
    const text = buildDefaultInstructions(true);

    expect(text).not.toContain("`scrape_docs`");
    expect(text).not.toContain("`get_job_info`");
    expect(text).toContain("cannot index new documentation");
  });
});
