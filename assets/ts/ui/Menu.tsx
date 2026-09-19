/**
 * Menu — a menu button following the WAI-ARIA menu-button pattern.
 *
 * The placement rules are not preferences. Each is a defect this repository
 * has already hit, in a portal table, on a real screen:
 *
 *   - The popup is `fixed`, against the trigger's viewport rect. A menu inside
 *     a table's `overflow: auto` wrapper is otherwise clipped by it, which is
 *     invisible until the last row's menu opens.
 *   - It flips above the trigger when there is not room below. The last row of
 *     a long table is exactly where a row menu is most likely to be used, and
 *     it is the one place a downward popup falls off the viewport.
 *   - It is clamped into the viewport horizontally, so an end-aligned menu on
 *     a narrow screen cannot push the page sideways.
 *   - It follows its trigger on scroll rather than closing. Closing on scroll
 *     means a trackpad twitch — or any momentum at all on a touch screen —
 *     eats the menu the moment it opens.
 *   - Focus moves with `preventScroll: true`. Focusing an item inside a
 *     scrollable region otherwise jumps the whole document.
 *
 * Disabled items are rendered disabled, not hidden. A menu whose length
 * changes with permissions gives the reader nothing stable to aim at, and
 * "why is that option missing" is a worse question than "why is it greyed".
 *
 * Keyboard contract: Enter/Space/ArrowDown open onto the first item, ArrowUp
 * opens onto the last, arrows and Home/End move within — skipping disabled
 * items — Escape closes and returns focus to the trigger, Tab closes and lets
 * focus continue naturally.
 */

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";

import { MenuLevel } from "./MenuLevel";
import "./Menu.css";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ComponentChildren;
  onSelect: () => void;
  /** Navigation within a paginated menu keeps the popup available. */
  keepOpen?: boolean;
  /** Choices opened as a submenu, with keyboard return to their parent. */
  children?: readonly MenuItem[];
  /** Renders in the destructive tone. Does not change behaviour. */
  danger?: boolean;
  disabled?: boolean;
  /**
   * A choice among alternatives — a sort direction, a filter value — carries
   * its state: the item is announced as a radio item and drawn with a check
   * when it is the one in force. Leave undefined for a plain command.
   */
  checked?: boolean;
  /** Draws a rule above the item: the start of a new group of choices. */
  separatorBefore?: boolean;
}

export interface MenuProps {
  /** Accessible name for the trigger. */
  label: string;
  items: readonly MenuItem[];
  /** Optional heading rendered above the items, e.g. the row's subject. */
  heading?: string;
  /**
   * Which edge of the popup lines up with the trigger. `end` is right for a
   * menu at the end of a table row, where a start-aligned popup would hang off
   * the table's right edge.
   */
  align?: "start" | "end";
  /**
   * `icon` is the square ⋯ button. `plain` drops the trigger's own chrome so a
   * caller can make the trigger something else entirely — an avatar and a
   * name, in the portal sidebar — without overriding styles from outside.
   */
  variant?: "icon" | "plain";
  /** Trigger content. Defaults to a horizontal ellipsis. */
  children?: ComponentChildren;
}

export function Menu({ label, items, heading, align = "start", variant = "icon", children }: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [initialLast, setInitialLast] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, close]);
  return (
    <div class="pk-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        class={["pk-menu__trigger", variant === "plain" ? "pk-menu__trigger--plain" : null].filter(Boolean).join(" ")}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setInitialLast(false);
          if (open) close(true);
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setInitialLast(event.key === "ArrowUp");
            setOpen(true);
          }
        }}
      >
        {children ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open && (
        <MenuLevel
          id={menuId}
          label={label}
          items={items}
          heading={heading}
          anchorRef={triggerRef}
          align={align}
          initialLast={initialLast}
          close={close}
        />
      )}
    </div>
  );
}
