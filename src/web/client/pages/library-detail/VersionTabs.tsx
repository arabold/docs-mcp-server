/**
 * Version switcher for the Library Detail page: one `.ver-tab` button per
 * indexed version (a status dot + version label), plus a trailing "Add
 * version" tab that opens the shared documentation drawer pre-filled with
 * the current library.
 */
import type { VersionSummary } from "../../../../store/types";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/StatusDot";
import { aggregateStatus, versionTabLabel } from "./format";

export interface VersionTabsProps {
  /** The library's versions, in the order returned by `listLibraries`. */
  versions: VersionSummary[];
  /** The currently selected version (empty string for unversioned). */
  activeVersion: string;
  /** Called with the version to switch to when a tab is clicked. */
  onSelect: (version: string) => void;
  /** Called when the trailing "Add version" tab is clicked. */
  onAddVersion: () => void;
}

/**
 * @example
 * <VersionTabs versions={lib.versions} activeVersion={activeVersion} onSelect={setActiveVersion} onAddVersion={openAddDrawer} />
 */
export function VersionTabs({
  versions,
  activeVersion,
  onSelect,
  onAddVersion,
}: VersionTabsProps) {
  return (
    <div className="ver-tabs">
      {versions.map((v) => {
        const status = aggregateStatus([v.status]);
        const isActive = v.ref.version === activeVersion;
        return (
          <button
            key={v.ref.version}
            type="button"
            className={isActive ? "ver-tab is-active" : "ver-tab"}
            aria-pressed={isActive}
            onClick={() => onSelect(v.ref.version)}
          >
            <StatusDot variant={status.variant} pulse={status.pulse} />
            {versionTabLabel(v.ref.version)}
          </button>
        );
      })}
      <button
        type="button"
        className="ver-tab"
        style={{ color: "var(--text-faint)" }}
        onClick={onAddVersion}
      >
        <Icon name="i-plus" size="xs" />
        Add version
      </button>
    </div>
  );
}
