/**
 * Centered "nothing here yet" placeholder (`.empty-state`, a design-system
 * addition — the mockup always shows populated example data). Used inside a
 * `Card` for empty tables/lists (no libraries indexed, no search results, …).
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  /** Optional call-to-action, e.g. a `<Button>`. */
  action?: ReactNode;
}

/**
 * @example
 * <EmptyState
 *   icon="i-books"
 *   title="No libraries indexed yet"
 *   description="Add documentation to start building your knowledge base."
 *   action={<Button onClick={openDrawer}>Add documentation</Button>}
 * />
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon ? (
        <div className="empty-state__icon">
          <Icon name={icon} />
        </div>
      ) : null}
      <div className="empty-state__title">{title}</div>
      {description ? <div className="empty-state__desc">{description}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
