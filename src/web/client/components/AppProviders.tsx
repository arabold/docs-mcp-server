/**
 * Composes the app-wide overlay providers (toasts, confirm dialog, the
 * add/edit documentation drawer) in the order they depend on each other:
 * the drawer shows toasts on success/failure, so `ToastProvider` must be
 * the outermost. Mount once around the routed app (see `App.tsx`).
 */
import type { ReactNode } from "react";
import { DocumentationDrawerProvider } from "./AddEditDocumentationDrawer";
import { ConfirmProvider } from "./ConfirmDialog";
import { ToastProvider } from "./Toast";

/** @example <AppProviders><Routes>...</Routes></AppProviders> */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <DocumentationDrawerProvider>{children}</DocumentationDrawerProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
