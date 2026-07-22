/**
 * Labeled checkbox matching the mockup's `.check` (checkbox + bold label +
 * faint hint line), used throughout the Advanced options section of the
 * documentation drawer.
 */

import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: ReactNode;
}

/**
 * @example <Checkbox label="Follow redirects" hint="Follow 3xx responses automatically." defaultChecked />
 */
export function Checkbox({ label, hint, id, className, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  const classes = className ? `check ${className}` : "check";
  return (
    <div className={classes}>
      <input id={checkboxId} type="checkbox" {...rest} />
      <div>
        <label htmlFor={checkboxId} className="lbl">
          {label}
        </label>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
    </div>
  );
}
