/**
 * Shared text input matching the mockup's `.input` (optionally wrapped in a
 * `.field` with a leading icon, `.has-icon`). Supports an optional label +
 * hint above/below, following `.form-row`.
 */

import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { Icon, type IconName } from "./Icon";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Label rendered above the field, following `.form-row > label`. */
  label?: ReactNode;
  /** Helper text rendered below the field, following `.form-row .hint`. */
  hint?: ReactNode;
  /** Leading icon rendered inside the field (adds `.has-icon` padding). */
  icon?: IconName;
}

/**
 * @example <Input label="Version" placeholder="e.g. 2.0.0 or latest" />
 * @example <Input icon="i-search" placeholder="Filter libraries…" />
 */
export function Input({ label, hint, icon, id, className, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? (label ? generatedId : undefined);
  const classes = ["input", icon ? "has-icon" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const field = icon ? (
    <div className="field">
      <Icon name={icon} size="sm" />
      <input id={inputId} className={classes} {...rest} />
    </div>
  ) : (
    <input id={inputId} className={classes} {...rest} />
  );

  if (!label && !hint) return field;

  return (
    <div className="form-row">
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      {field}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
