/**
 * Topbar theme toggle button. The icon reflects the *current preference* —
 * sun (light), moon (dark), or a split circle (auto/system) — so the active
 * mode is always distinguishable at a glance; clicking cycles the preference
 * auto -> light -> dark -> auto.
 */

import { useTheme } from "../hooks/useTheme";
import { Icon, type IconName } from "./Icon";

const PREFERENCE_LABEL: Record<string, string> = {
  auto: "system",
  light: "light",
  dark: "dark",
};

/** Icon shown for each preference — the current mode, not the "next" action. */
const PREFERENCE_ICON: Record<string, IconName> = {
  auto: "i-auto",
  light: "i-sun",
  dark: "i-moon",
};

/** Icon button that cycles the theme preference: auto -> light -> dark -> auto. */
export function ThemeToggle() {
  const { preference, cycleTheme } = useTheme();
  return (
    <button
      type="button"
      className="icon-btn"
      title={`Theme: ${PREFERENCE_LABEL[preference]} (click to change)`}
      aria-label={`Theme: ${PREFERENCE_LABEL[preference]}. Click to change.`}
      onClick={cycleTheme}
    >
      <Icon name={PREFERENCE_ICON[preference]} size="sm" />
    </button>
  );
}
