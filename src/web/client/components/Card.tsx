/**
 * Shared surface container matching the mockup's `.card` (white/dark
 * surface, border, radius, soft shadow). Everything else — padding via
 * `.panel`, grid layout, etc. — is composed by the caller with extra classes.
 */
import type { HTMLAttributes } from "react";

export type CardProps = HTMLAttributes<HTMLDivElement>;

/**
 * @example <Card className="panel">...</Card>
 */
export function Card({ className, ...rest }: CardProps) {
  const classes = className ? `card ${className}` : "card";
  return <div className={classes} {...rest} />;
}
