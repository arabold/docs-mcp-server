/**
 * Thoroughly removes all types of whitespace characters from both ends of a string.
 * Handles spaces, tabs, line breaks, and carriage returns.
 */
export const fullTrim = (str: string): string => {
  return str.replace(/^[\s\r\n\t]+|[\s\r\n\t]+$/g, "");
};

/**
 * Formats a byte count as a human-readable size string using binary units.
 *
 * @param bytes Number of bytes
 * @returns Formatted size such as `12.4 MB`
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
