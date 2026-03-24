import path from "node:path";
import { TarAdapter } from "./TarAdapter";
import type { ArchiveAdapter } from "./types";
import { ZipAdapter } from "./ZipAdapter";

/**
 * Returns an appropriate archive adapter for the given file path based on its
 * extension, or `null` if the file is not a recognized archive format.
 *
 * Detection relies exclusively on file extensions (`.zip`, `.tar`, `.gz`,
 * `.tgz`). Magic byte inspection is intentionally omitted because many
 * document formats (DOCX, XLSX, PPTX, EPUB, ODT, ODS, ODP) are internally
 * ZIP archives sharing the same `PK` signature. Treating them as archives
 * would prevent proper document extraction via `DocumentPipeline`.
 */
export async function getArchiveAdapter(
  filePath: string,
): Promise<ArchiveAdapter | null> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".zip") {
    return new ZipAdapter(filePath);
  }
  if (ext === ".tar" || ext === ".gz" || ext === ".tgz") {
    return new TarAdapter(filePath);
  }

  return null;
}
