import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../../utils/logger";
import { TarAdapter } from "./TarAdapter";
import type { ArchiveAdapter } from "./types";
import { ZipAdapter } from "./ZipAdapter";

export async function getArchiveAdapter(
  filePath: string,
): Promise<ArchiveAdapter | null> {
  const ext = path.extname(filePath).toLowerCase();

  // Check extension first
  if (ext === ".zip") {
    return new ZipAdapter(filePath);
  }
  if (ext === ".tar" || ext === ".gz" || ext === ".tgz") {
    // Basic check for gzip or tar signature if needed, but extension is fast
    return new TarAdapter(filePath);
  }

  // Fallback: Check magic bytes if extension is missing or weird?
  // For now, rely on extension as per standard scraping practices.
  // We could add magic byte check here later.

  // Quick magic byte check for reliability
  const BUFFER_SIZE = 262; // Tar header is 512, Zip is small. 262 covers ustar at 257+5
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(BUFFER_SIZE);
    const { bytesRead } = await handle.read(buffer, 0, BUFFER_SIZE, 0);

    if (bytesRead < 2) return null;

    // ZIP: PK..
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      return new ZipAdapter(filePath);
    }

    // GZIP: 1f 8b
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return new TarAdapter(filePath);
    }

    // TAR: ustar at offset 257 usually
    if (bytesRead >= BUFFER_SIZE) {
      const magic = buffer.subarray(257, 262).toString();
      if (magic === "ustar") {
        return new TarAdapter(filePath);
      }
    }
  } catch (error) {
    // If file read fails, we can't process
    logger.debug(`Failed to check magic bytes for ${filePath}: ${error}`);
    return null;
  } finally {
    if (handle) await handle.close();
  }

  return null;
}
