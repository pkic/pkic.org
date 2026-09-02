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
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

import { applyPopupPosition, measurePopupPosition, type PopupPosition } from "./popup-placement";
import "./Menu.css";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<PopupPosition | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Indexes into the rendered list, so `activeIndex` and the DOM agree even
  // though disabled items are rendered but never focused.
  const reachable = items.flatMap((item, index) => (item.disabled ? [] : [index]));
  const firstReachable = reachable[0] ?? -1;
  const lastReachable = reachable[reachable.length - 1] ?? -1;

  function step(from: number, delta: number): number {
    if (reachable.length === 0) return -1;
    const at = reachable.indexOf(from);
    if (at === -1) return delta > 0 ? firstReachable : lastReachable;
    return reachable[(at + delta + reachable.length) % reachable.length];
  }

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setActiveIndex(-1);
      if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    },
    [setOpen, setActiveIndex],
  );

  /**
   * Resolves the popup's viewport position from the trigger's rect and the
   * popup's own measured size. Called on open and again whenever the page
   * moves underneath it.
   *
   * Returns null before the popup exists, which is the first render after
   * opening: the effect below runs once the popup is in the document and
   * fills the position in then.
   */
  const measure = useCallback((): PopupPosition | null => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return null;
    return measurePopupPosition(trigger.getBoundingClientRect(), popup.getBoundingClientRect(), align);
  }, [align]);

  const openAt = useCallback(
    (index: number) => {
      setOpen(true);
      setActiveIndex(index);
    },
    [setOpen, setActiveIndex],
  );

  // Why imperative rather than a style attribute: see popup-placement.ts.
  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup || !position) return;
    applyPopupPosition(popup, position);
  }, [position]);

  // Measure once the popup is in the document, and again if the item list
  // changes size underneath it.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    setPosition(measure());
  }, [open, measure, items.length, heading]);

  // Focus follows the active index rather than being set at each call site, so
  // there is one place where focus can go wrong.
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // A fixed popup does not move with its trigger, so it is re-placed as the
    // page moves. It used to close instead, which meant any scroll momentum —
    // unavoidable on a touch screen — dismissed the menu on the way to it.
    const onReflow = () => setPosition(measure());

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, close, measure]);

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAt(firstReachable);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(lastReachable);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => step(current, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => step(current, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstReachable);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastReachable);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  }

  return (
    <div class="pk-menu">
      <button
        ref={triggerRef}
        type="button"
        class={["pk-menu__trigger", variant === "plain" ? "pk-menu__trigger--plain" : null].filter(Boolean).join(" ")}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(true) : openAt(firstReachable))}
        onKeyDown={onTriggerKeyDown}
      >
        {children ?? <span aria-hidden="true">⋯</span>}
      </button>

      {open && (
        <div ref={popupRef} id={menuId} role="menu" aria-label={label} class="pk-menu__popup" onKeyDown={onMenuKeyDown}>
          {heading && <p class="pk-menu__heading">{heading}</p>}
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked === undefined ? undefined : item.checked ? "true" : "false"}
              disabled={item.disabled}
              tabIndex={index === activeIndex ? 0 : -1}
              class={[
                "pk-menu__item",
                item.danger ? "pk-menu__item--danger" : null,
                item.checked !== undefined ? "pk-menu__item--choice" : null,
                item.separatorBefore ? "pk-menu__item--separated" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => select(item)}
            >
              {item.checked !== undefined && (
                <span class="pk-menu__check" aria-hidden="true">
                  {item.checked ? "✓" : ""}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
