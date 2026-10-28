import type { ComponentChildren } from "preact";
import "./ContentProse.css";

/** One reading presentation for public content and the full visual editor. */
export const CONTENT_PROSE_CLASS = "pk pk-content-prose";

export function ContentProse({ children, class: className }: { children: ComponentChildren; class?: string }) {
  return <div class={[CONTENT_PROSE_CLASS, className].filter(Boolean).join(" ")}>{children}</div>;
}
