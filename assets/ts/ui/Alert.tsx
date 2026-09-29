/**
 * Alert — an inline message block with tonal styling.
 *
 * Renders semantically according to severity: role="alert" for destructive
 * tones (warn, danger) and role="status" for informational tones. Tones set
 * local CSS variables so the layout rule uses the same structure for all
 * four variants.
 */

import type { ComponentChildren } from "preact";

import "./Alert.css";

export type AlertTone = "ok" | "warn" | "danger" | "info";

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ComponentChildren;
}

export function Alert({ tone = "info", title, children }: AlertProps) {
  const isWarning = tone === "warn" || tone === "danger";
  const role = isWarning ? "alert" : "status";

  return (
    <div class={`pk-alert pk-alert--${tone}`} role={role}>
      {title && <div class="pk-alert__title">{title}</div>}
      {children && <div class="pk-alert__body">{children}</div>}
    </div>
  );
}
