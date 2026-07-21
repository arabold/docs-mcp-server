/**
 * Generic centered modal matching the mockup's `.modal-scrim`/`.modal`
 * (used internally by `ConfirmDialog.tsx`, and available for any other
 * centered dialog a page needs). Stays mounted even while closed so the
 * open/close opacity + scale transitions can play; closes on Escape or a
 * click on the scrim itself.
 */

import type { ReactNode } from "react";
import { useEffect } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  "aria-labelledby"?: string;
}

/**
 * @example
 * <Modal open={open} onClose={close} aria-labelledby="my-modal-title">
 *   <h3 id="my-modal-title">Delete item?</h3>
 *   <p>This can't be undone.</p>
 * </Modal>
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  "aria-labelledby": labelledBy,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={`modal-scrim${open ? " open" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-hidden={!open}
    >
      <div
        className={["modal", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}
