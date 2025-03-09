import type { VectorStoreManager } from "../store/index.js";
import { logger } from "../utils/logger";

export interface ListLibrariesOptions {
  store: VectorStoreManager;
}

export interface LibraryVersion {
  version: string;
  indexed: boolean;
}

export interface LibraryInfo {
  name: string;
  versions: LibraryVersion[];
}

export interface ListLibrariesResult {
  libraries: LibraryInfo[];
}

export interface FindVersionOptions {
  store: VectorStoreManager;
  library: string;
  targetVersion?: string;
}

export const listLibraries = async (
  options: ListLibrariesOptions
): Promise<ListLibrariesResult> => {
  const { store } = options;
  const rawLibraries = await store.listLibraries();

  const libraries = rawLibraries.map(({ library, versions }) => ({
    name: library,
    versions: versions.map((v) => ({
      version: v.version,
      indexed: v.indexed,
    })),
  }));

  return { libraries };
};

export const findVersion = async (
  options: FindVersionOptions
): Promise<string | null> => {
  const { store, library, targetVersion } = options;
  return store.findBestVersion(library, targetVersion);
};
