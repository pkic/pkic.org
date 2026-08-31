/**
 * Menu — a menu button following the WAI-ARIA menu-button pattern.
 *
 * Two behaviours here are not preferences; they are defects this repository
 * has already hit once and fixed:
 *
 *   - The popup is positioned `fixed` against the trigger's viewport rect.
 *     A menu inside a table's `overflow: auto` wrapper is otherwise clipped by
 *     it, which is invisible until the last row's menu opens.
 *   - Focus moves with `preventScroll: true`. Focusing an item inside a
 *     scrollable region otherwise jumps the whole document.
 *
 * Keyboard contract: Enter/Space/ArrowDown open onto the first item, ArrowUp
 * opens onto the last, arrows and Home/End move within, Escape closes and
 * returns focus to the trigger, Tab closes and lets focus continue naturally.
 */

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

import "./Menu.css";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /** Renders in the destructive tone. Does not change behaviour. */
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  /** Accessible name for the trigger. */
  label: string;
  items: readonly MenuItem[];
  /** Optional heading rendered above the items, e.g. the row's subject. */
  heading?: string;
  /** Trigger content. Defaults to a horizontal ellipsis. */
  children?: ComponentChildren;
}

interface Position {
  top: number;
  left: number;
}

export function Menu({ label, items, heading, children }: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<Position | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const enabled = items.filter((item) => !item.disabled);

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setActiveIndex(-1);
      if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    },
    [setOpen, setActiveIndex],
  );

  const openAt = useCallback(
    (index: number) => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, left: rect.left });
      setOpen(true);
      setActiveIndex(index);
    },
    [setOpen, setActiveIndex],
  );

  // Placement is applied imperatively rather than as a `style` attribute: the
  // value is viewport geometry, which no stylesheet can express, and the
  // repository forbids style attributes in markup. CSS anchor positioning will
  // replace this once Firefox ships it.
  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup || !position) return;
    popup.style.setProperty("top", `${position.top}px`);
    popup.style.setProperty("left", `${position.left}px`);
  }, [position]);

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
    // A fixed popup does not move with its trigger, so it has to close rather
    // than drift away from the row it belongs to.
    const onReflow = () => close(false);

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, close]);

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAt(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(Math.max(enabled.length - 1, 0));
    }
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const last = enabled.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => (current >= last ? 0 : current + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? last : current - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(last);
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
    close(true);
    item.onSelect();
  }

  return (
    <div class="pk-menu">
      <button
        ref={triggerRef}
        type="button"
        class="pk-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(true) : openAt(0))}
        onKeyDown={onTriggerKeyDown}
      >
        {children ?? <span aria-hidden="true">⋯</span>}
      </button>

      {open && (
        <div ref={popupRef} id={menuId} role="menu" aria-label={label} class="pk-menu__popup" onKeyDown={onMenuKeyDown}>
          {heading && <p class="pk-menu__heading">{heading}</p>}
          {enabled.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              class={["pk-menu__item", item.danger ? "pk-menu__item--danger" : null].filter(Boolean).join(" ")}
              onClick={() => select(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
