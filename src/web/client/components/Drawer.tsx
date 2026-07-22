/**
 * Generic slide-over panel matching the mockup's `.scrim`/`.drawer`
 * (used by `AddEditDocumentationDrawer.tsx`; also available for any other
 * right-hand-side panel a page needs). Stays mounted while closed so the
 * slide + fade transitions can play; closes on Escape or a scrim click.
 */

import type { ReactNode } from "react";
import { useEffect } from "react";
import { Icon, type IconName } from "./Icon";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Icon shown in the header, before the title. @default "i-plus" */
  icon?: IconName;
  title: ReactNode;
  /** Body content, typically a stack of `.form-row`s. */
  children: ReactNode;
  /** Footer content, typically Cancel + submit `<Button>`s (`.drawer__foot`). */
  footer?: ReactNode;
}

/**
 * @example
 * <Drawer open={open} onClose={close} title="Add documentation" footer={<>...</>}>
 *   <Input label="Library name" />
 * </Drawer>
 */
export function Drawer({
  open,
  onClose,
  icon = "i-plus",
  title,
  children,
  footer,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`scrim${open ? " open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`drawer${open ? " open" : ""}`} aria-hidden={!open}>
        <div className="drawer__head">
          <Icon name={icon} style={{ color: "var(--primary)" }} />
          <h3>{title}</h3>
          <button
            type="button"
            className="icon-btn"
            style={{ marginLeft: "auto", boxShadow: "none" }}
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="i-close" size="sm" />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer ? <div className="drawer__foot">{footer}</div> : null}
      </aside>
    </>
  );
}
