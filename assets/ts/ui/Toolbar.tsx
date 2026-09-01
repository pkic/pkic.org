/**
 * Toolbar — the controls above a list.
 *
 * Houses a search input and filters/actions. Below 48rem the toolbar wraps
 * and the search input takes a full-width row of its own.
 */

import type { ComponentChildren, JSX } from "preact";
import { useId } from "preact/hooks";

import "./Toolbar.css";

export interface ToolbarProps extends JSX.HTMLAttributes<HTMLDivElement> {
  /** The accessible name for the toolbar. */
  label: string;
  /** Optional search configuration. */
  search?: {
    value: string;
    placeholder?: string;
    onInput: (value: string) => void;
    /**
     * Names the field — "Search members", not "Search".
     *
     * A page can hold several collections, and several inputs all called
     * "Search" are indistinguishable to anyone navigating by form controls.
     * The visible label stays short; the accessible name says which list.
     */
    label?: string;
  };
  children?: ComponentChildren;
}

export function Toolbar({ label, search, class: className, children, ...rest }: ToolbarProps) {
  const searchId = useId();
  const classes = ["pk-toolbar", className].filter(Boolean).join(" ");

  return (
    <div class={classes} role="toolbar" aria-label={label} {...rest}>
      {search && (
        <div class="pk-toolbar__search">
          <label htmlFor={searchId} class="pk-toolbar__search-label">
            {search.label ?? "Search"}
          </label>
          <input
            id={searchId}
            type="search"
            class="pk-toolbar__search-input"
            value={search.value}
            placeholder={search.placeholder}
            onInput={(e) => {
              const target = e.target as HTMLInputElement;
              search.onInput(target.value);
            }}
          />
        </div>
      )}
      {children && <div class="pk-toolbar__controls">{children}</div>}
    </div>
  );
}
