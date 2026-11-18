/**
 * Parses an absolute or relative address on all supported Node 22 releases.
 * @param address The URL to parse.
 * @param base Optional base URL for relative addresses.
 * @returns The parsed URL or undefined for invalid input.
 */
export function parseUrl(address: string, base?: string | URL): URL | undefined {
  try {
    return new URL(address, base);
  } catch {
    return undefined;
  }
}

/**
 * Normalizes a heading or URL target for comparison with indexed section names.
 * @param value Heading text or a URL anchor.
 * @returns A normalized section name.
 */
export function sectionSlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extracts a section selector from a URL or a relative page path.
 * @param address The page URL or path.
 * @returns A fragment or a lone `id` selector, if present.
 */
export function sectionSelector(address: string): string | undefined {
  const url = parseUrl(address, "http://localhost");
  if (!url || url.hash.startsWith("#/") || url.hash.startsWith("#!")) return undefined;
  if (url.hash) {
    try {
      return decodeURIComponent(url.hash.slice(1));
    } catch {
      return undefined;
    }
  }
  const entries = [...url.searchParams];
  return entries.length === 1 && entries[0][0] === "id" ? entries[0][1] : undefined;
}

/**
 * Identifies the base address of an HTTP page with a lone `id` selector.
 * @param address Stored or fetched page address.
 * @returns The URL without the selector, or undefined for other addresses.
 */
export function sectionQueryBase(address: string): string | undefined {
  const url = parseUrl(address);
  if (!url || !["http:", "https:"].includes(url.protocol) || url.hash) return undefined;
  if (!sectionSelector(address)) return undefined;
  url.search = "";
  return url.href;
}
