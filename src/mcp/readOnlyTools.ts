import type { ReadOnlyDocumentManagement } from "../store/ReadOnlyDocumentManagementService";
import { FindVersionTool } from "../tools/FindVersionTool";
import { ListLibrariesTool } from "../tools/ListLibrariesTool";
import { SearchTool } from "../tools/SearchTool";
import type { ReadOnlyMcpTools } from "./tools";

/** Creates only the indexed-document tools exposed by the MCPB extension. */
export function initializeReadOnlyTools(
  documentService: ReadOnlyDocumentManagement,
): ReadOnlyMcpTools {
  return {
    listLibraries: new ListLibrariesTool(documentService),
    findVersion: new FindVersionTool(documentService),
    search: new SearchTool(documentService),
  };
}
