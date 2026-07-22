/**
 * App-wide confirmation dialog, matching the mockup's confirm modal
 * (`.modal__icon` + trash icon, title, body, Cancel/danger-action buttons).
 * Mount `ConfirmProvider` once near the app root (see `Shell.tsx`), then call
 * `useConfirm()` from any component to request a yes/no decision as a
 * promise — no local dialog-open state needed at the call site.
 *
 * @example
 * const confirm = useConfirm();
 * const ok = await confirm({
 *   title: "Remove version",
 *   description: <>This permanently removes <b>react 19.0</b> and its <b>14,880 chunks</b> from the index. This can't be undone.</>,
 * });
 * if (ok) await removeVersion.mutateAsync({ library: "react", version: "19.0" });
 */

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  /** Dialog title, e.g. "Remove version". A "?" is appended automatically. */
  title: string;
  /** Body content — plain text or JSX (e.g. with `<b>` emphasis), matching the mockup's copy style. */
  description: ReactNode;
  /** Label for the destructive/confirm button. @default "Remove" */
  confirmLabel?: string;
  /** Label for the dismiss button. @default "Cancel" */
  cancelLabel?: string;
  /** Uses the danger (red) icon + button styling. @default true */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/** Provides the `useConfirm()` hook to the component tree below it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback(
    (value: boolean) => {
      pending?.resolve(value);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => settle(false)}
        aria-labelledby="confirm-dialog-title"
      >
        {pending ? (
          <>
            <div
              className="modal__icon"
              style={
                pending.danger === false
                  ? { background: "var(--primary-soft)", color: "var(--primary)" }
                  : undefined
              }
            >
              <Icon name="i-trash" />
            </div>
            <h3 id="confirm-dialog-title">{pending.title}?</h3>
            <p>{pending.description}</p>
            <div className="modal__actions">
              <Button variant="ghost" onClick={() => settle(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={pending.danger === false ? "primary" : "danger"}
                onClick={() => settle(true)}
              >
                <Icon name="i-trash" size="sm" />
                {pending.confirmLabel ?? "Remove"}
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns a function that opens the shared confirm dialog and resolves to
 * `true`/`false` once the user decides. Must be called under `ConfirmProvider`.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return confirm;
}
