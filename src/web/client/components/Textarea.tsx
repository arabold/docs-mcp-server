/**
 * Shared multi-line text field matching the mockup's `textarea.input`, with
 * an optional label + hint above/below following `.form-row`.
 */

import type { ReactNode, TextareaHTMLAttributes } from "react";
import { useId } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Label rendered above the field, following `.form-row > label`. */
  label?: ReactNode;
  /** Helper text rendered below the field, following `.form-row .hint`. */
  hint?: ReactNode;
}

/**
 * @example
 * <Textarea
 *   label="Exclude patterns"
 *   hint="Default patterns are pre-filled. Exclude takes precedence over include."
 *   rows={4}
 * />
 */
export function Textarea({ label, hint, id, className, ...rest }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? (label ? generatedId : undefined);
  const classes = className ? `input ${className}` : "input";
  const field = <textarea id={textareaId} className={classes} {...rest} />;

  if (!label && !hint) return field;

  return (
    <div className="form-row">
      {label ? <label htmlFor={textareaId}>{label}</label> : null}
      {field}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
