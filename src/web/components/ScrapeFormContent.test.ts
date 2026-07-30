import { describe, expect, it } from "vitest";
import ScrapeFormContent from "./ScrapeFormContent";

describe("ScrapeFormContent", () => {
  it("renders the respectGitignore option as opt-in", async () => {
    const defaultHtml = String(await ScrapeFormContent({}));
    const enabledHtml = String(
      await ScrapeFormContent({ initialValues: { respectGitignore: true } }),
    );

    expect(defaultHtml).toContain('name="respectGitignore"');
    expect(defaultHtml).not.toMatch(/name="respectGitignore"[^>]*checked/);
    expect(enabledHtml).toMatch(/name="respectGitignore"[^>]*checked/);
  });
});
