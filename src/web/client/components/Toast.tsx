/**
 * App-wide toast notifications (`.toast-viewport`/`.toast` — a design-system
 * addition; the mockup has no toast component, so this is styled from the
 * same tokens rather than ported). Mount `ToastProvider` once near the app
 * root (see `Shell.tsx`), then call `useToast()` from any component to push
 * a message. Toasts auto-dismiss after a few seconds and can be dismissed
 * manually.
 *
 * @example
 * const toast = useToast();
 * toast.success("Indexing started");
 * toast.error("Failed to remove version", "Try again in a moment.");
 */

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

export type ToastVariant = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  variant: ToastVariant;
  title: ReactNode;
  description?: ReactNode;
}

export interface ToastApi {
  /** Pushes a toast of the given variant; returns its id (for manual dismissal). */
  show: (variant: ToastVariant, title: ReactNode, description?: ReactNode) => number;
  success: (title: ReactNode, description?: ReactNode) => number;
  error: (title: ReactNode, description?: ReactNode) => number;
  info: (title: ReactNode, description?: ReactNode) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 5000;
const ICON_BY_VARIANT = { success: "i-check", error: "i-x", info: "i-bolt" } as const;

/** Provides the `useToast()` hook and renders the fixed bottom-right toast stack. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (variant, title, description) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, variant, title, description }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show("success", title, description),
      error: (title, description) => show("error", title, description),
      info: (title, description) => show("info", title, description),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}`} role="status">
            <span className="toast__icon">
              <Icon name={ICON_BY_VARIANT[t.variant]} size="sm" />
            </span>
            <div className="toast__body">
              <div>{t.title}</div>
              {t.description ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {t.description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="i-close" size="xs" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns the toast API. Must be called under `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return api;
}
