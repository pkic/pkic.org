import type { ComponentChildren, JSX } from "preact";
import "./Panel.css";
import "./CollapsiblePanel.css";

/** Native disclosure with the same surface and header as other detail panels.
 * Tables can be direct children so their cell inset matches the title;
 * prose and forms use PanelBody for the standard content inset.
 */
export function CollapsiblePanel({
  title,
  children,
  ...rest
}: {
  title: string;
  children: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDetailsElement>, "title">) {
  return (
    <details {...rest} class={["pk-panel", rest.class].filter(Boolean).join(" ")}>
      <summary class="pk-panel__header pk-panel__disclosure">
        <span class="pk-panel__title">{title}</span>
      </summary>
      {children}
    </details>
  );
}
