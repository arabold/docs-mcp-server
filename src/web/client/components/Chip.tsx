/**
 * Small mono-font tag matching the mockup's `.chip` (version numbers, MIME
 * types, counts, etc.).
 */
import type { HTMLAttributes } from "react";

export type ChipProps = HTMLAttributes<HTMLSpanElement>;

/**
 * @example <Chip>v15.1</Chip>
 */
export function Chip({ className, ...rest }: ChipProps) {
  const classes = className ? `chip ${className}` : "chip";
  return <span className={classes} {...rest} />;
}
