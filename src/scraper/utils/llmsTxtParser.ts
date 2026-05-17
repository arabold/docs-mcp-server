export interface LlmsTxtLink {
  title: string;
  url: string;
  description?: string;
  optional: boolean;
  section?: string;
}

export interface LlmsTxtSection {
  title: string;
  optional: boolean;
  links: LlmsTxtLink[];
}

export interface LlmsTxtResult {
  projectName?: string;
  summary?: string;
  sections: LlmsTxtSection[];
  links: LlmsTxtLink[];
}

const emptyLlmsTxtResult = (): LlmsTxtResult => ({
  sections: [],
  links: [],
});

const markdownLinkPattern = /^\s*[-*+]\s+\[([^\]\n]+)]\(([^)\s]+)\)\s*(?::\s*(.+?)\s*)?$/;

/**
 * Parses llms.txt Markdown into project metadata and curated links.
 * @param content The llms.txt Markdown content.
 * @returns Parsed llms.txt metadata and links, or an empty result for invalid content.
 */
export function parseLlmsTxt(content: string): LlmsTxtResult {
  if (!content.trim() || content.includes("\0")) {
    return emptyLlmsTxtResult();
  }

  if (/^\s*<(?:!doctype\s+html|html|body|head)(?:\s|>)/i.test(content)) {
    return emptyLlmsTxtResult();
  }

  const lines = content.split(/\r?\n/);
  const firstH1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (firstH1Index === -1) {
    return emptyLlmsTxtResult();
  }

  const projectName = lines[firstH1Index].replace(/^#\s+/, "").trim();
  if (!projectName) {
    return emptyLlmsTxtResult();
  }

  const result: LlmsTxtResult = {
    projectName,
    sections: [],
    links: [],
  };

  let currentSection: LlmsTxtSection | undefined;
  const summaryLines: string[] = [];
  let collectingSummary = true;

  for (const line of lines.slice(firstH1Index + 1)) {
    if (/^#\s+\S/.test(line)) {
      collectingSummary = false;
      continue;
    }

    const h2Match = /^##\s+(.+?)\s*$/.exec(line);
    if (h2Match) {
      collectingSummary = false;
      const title = h2Match[1].trim();
      currentSection = {
        title,
        optional: title.toLowerCase() === "optional",
        links: [],
      };
      result.sections.push(currentSection);
      continue;
    }

    if (collectingSummary) {
      if (/^>\s?/.test(line)) {
        summaryLines.push(line.replace(/^>\s?/, "").trim());
        continue;
      }
      if (summaryLines.length > 0 && line.trim() === "") {
        continue;
      }
      if (line.trim() !== "") {
        collectingSummary = false;
      }
    }

    const linkMatch = markdownLinkPattern.exec(line);
    if (!linkMatch) {
      continue;
    }

    const link: LlmsTxtLink = {
      title: linkMatch[1].trim(),
      url: linkMatch[2].trim(),
      optional: currentSection?.optional ?? false,
      ...(currentSection ? { section: currentSection.title } : {}),
      ...(linkMatch[3]?.trim() ? { description: linkMatch[3].trim() } : {}),
    };

    currentSection?.links.push(link);
    result.links.push(link);
  }

  if (summaryLines.length > 0) {
    result.summary = summaryLines.join("\n");
  }

  if (result.links.length === 0) {
    return emptyLlmsTxtResult();
  }

  return result;
}
