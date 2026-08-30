/**
 * Accessible dropdown menu primitive following the WAI-ARIA menu-button
 * pattern. Callers provide actions; navigation targets call their router in
 * `onSelect` so this primitive stays router-agnostic.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface MenuProps {
  /** Accessible name for the trigger button. */
  label: string;
  /** Trigger content; falls back to the accessible label. */
  buttonContent?: ComponentChildren;
  buttonClass?: string;
  align?: "start" | "end";
  actions: readonly MenuAction[];
}

export function Menu({ label, buttonContent, buttonClass, align = "start", actions }: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndexes = actions.map((action, index) => (action.disabled ? null : index)).filter((v) => v !== null);

  function focusItem(index: number): void {
    itemRefs.current[index]?.focus();
  }

  function openAndFocus(index: number): void {
    setOpen(true);
    // The menu renders after state settles; focus on the next frame.
    requestAnimationFrame(() => focusItem(index));
  }

  function close(refocusButton: boolean): void {
    setOpen(false);
    if (refocusButton) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function onButtonKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAndFocus(enabledIndexes[0] ?? 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAndFocus(enabledIndexes[enabledIndexes.length - 1] ?? 0);
    } else if (event.key === "Escape") {
      close(true);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent, currentIndex: number): void {
    const position = enabledIndexes.indexOf(currentIndex);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(enabledIndexes[(position + 1) % enabledIndexes.length]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(enabledIndexes[(position - 1 + enabledIndexes.length) % enabledIndexes.length]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(enabledIndexes[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(enabledIndexes[enabledIndexes.length - 1]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div class="pkic-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        class={buttonClass ?? "pkic-menu-trigger"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAndFocus(enabledIndexes[0] ?? 0))}
        onKeyDown={onButtonKeyDown}
      >
        {buttonContent ?? label}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} class={`pkic-menu-popup pkic-menu-${align}`}>
          {actions.map((action, index) => (
            <button
              key={action.key}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              class="pkic-menu-item"
              disabled={action.disabled}
              tabIndex={-1}
              onKeyDown={(event) => onMenuKeyDown(event, index)}
              onClick={() => {
                close(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
