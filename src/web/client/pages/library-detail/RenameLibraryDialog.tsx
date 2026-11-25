/**
 * Dialog on the Library Detail page that renames a library in place through
 * the `renameLibrary` procedure, the same store call the CLI `rename` command
 * makes. Versions and indexed content stay as they are; the store refuses the
 * rename while a job writes into the library or when the new name is taken,
 * and the dialog shows that refusal inline.
 */
import { type FormEvent, useEffect, useState } from "react";
import { useRenameLibrary } from "../../api/hooks";
import { trpc } from "../../api/trpc";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";

export interface RenameLibraryDialogProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** Current display name of the library. */
  library: string;
  /** Closes the dialog without renaming. */
  onClose: () => void;
  /** Called with the stored new display name after a successful rename. */
  onRenamed: (newName: string) => void;
}

/**
 * Asks for a new library name and renames the library.
 * @example
 * <RenameLibraryDialog open={open} library="react" onClose={close} onRenamed={(n) => navigate(n)} />
 */
export function RenameLibraryDialog({
  open,
  library,
  onClose,
  onRenamed,
}: RenameLibraryDialogProps) {
  const renameLibrary = useRenameLibrary();
  const utils = trpc.useUtils();
  const [newName, setNewName] = useState(library);
  const [error, setError] = useState<string | null>(null);

  // Start from the current name each time the dialog opens
  useEffect(() => {
    if (open) {
      setNewName(library);
      setError(null);
    }
  }, [open, library]);

  const trimmed = newName.trim();
  const unchanged = trimmed === library;
  const canSubmit = trimmed !== "" && !unchanged && !renameLibrary.isPending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      const result = await renameLibrary.mutateAsync({ library, newName: trimmed });
      onRenamed(result.newName);
      await utils.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal open={open} onClose={onClose} aria-labelledby="rename-library-title">
      <form onSubmit={handleSubmit}>
        <div
          className="modal__icon"
          style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
        >
          <Icon name="i-edit" />
        </div>
        <h3 id="rename-library-title">Rename library</h3>
        <p>
          Renames <b>{library}</b> and keeps its versions and indexed content. Searches
          must use the new name afterwards.
        </p>
        <div style={{ marginTop: 14 }}>
          <Input
            label="New name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={renameLibrary.isPending}
            autoFocus
            hint={
              error ? <span style={{ color: "var(--err)" }}>{error}</span> : undefined
            }
          />
        </div>
        <div className="modal__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            <Icon name="i-edit" size="sm" />
            {renameLibrary.isPending ? "Renaming…" : "Rename"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
