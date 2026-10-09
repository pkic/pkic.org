import { IconMonitor, IconMoon, IconSun } from "./MediaIcons";
import "./ThemeToggle.css";

export function ThemeToggle() {
  const systemLabel = "Theme: matching your system. Activate for the light theme.";
  return (
    <button type="button" class="pk-theme-toggle" data-theme-toggle aria-label={systemLabel} title={systemLabel}>
      <IconMonitor data-theme-icon="system" />
      <IconSun data-theme-icon="light" />
      <IconMoon data-theme-icon="dark" />
      <span class="pk-sr-only" data-theme-label>
        {systemLabel}
      </span>
    </button>
  );
}
