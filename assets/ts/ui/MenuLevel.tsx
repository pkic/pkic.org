import type { RefObject } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { MenuItem } from "./Menu";
import { usePopupPlacement } from "./popup-placement";

/** Each submenu keeps its parent visible and owns its keyboard focus. */
export function MenuLevel({
  id,
  label,
  items,
  heading,
  anchorRef,
  align = "start",
  initialLast = false,
  close,
  back,
}: {
  id: string;
  label: string;
  items: readonly MenuItem[];
  heading?: string;
  anchorRef: RefObject<HTMLElement>;
  align?: "start" | "end";
  initialLast?: boolean;
  close: (returnFocus: boolean) => void;
  back?: () => void;
}) {
  const childId = useId();
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | HTMLAnchorElement | null)[]>([]);
  const childAnchor = useRef<HTMLElement>(null);
  const reachable = items.flatMap((item, index) => (item.disabled ? [] : [index]));
  const [active, setActive] = useState((initialLast ? reachable.at(-1) : reachable[0]) ?? -1);
  const [child, setChild] = useState<string | null>(null);
  const childItem = items.find((item) => item.id === child && !item.disabled);
  const revision = items.map((item) => `${item.id}:${Boolean(item.disabled)}`).join("|");
  usePopupPlacement({ open: true, anchorRef, popupRef, align, side: back ? "right" : "bottom", revision });
  useLayoutEffect(() => {
    if (childItem) return;
    if (!reachable.includes(active)) {
      setActive(reachable[0] ?? -1);
      return;
    }
    const item = itemRefs.current[active];
    item?.focus({ preventScroll: true });
    if (item && popupRef.current) {
      const row = item.getBoundingClientRect();
      const bounds = popupRef.current.getBoundingClientRect();
      if (row.bottom > bounds.bottom) popupRef.current.scrollTop += row.bottom - bounds.bottom;
      else if (row.top < bounds.top) popupRef.current.scrollTop -= bounds.top - row.top;
    }
  }, [active, revision, childItem]);
  function select(item: MenuItem, index: number) {
    if (item.disabled) return;
    setActive(index);
    if (item.children) {
      childAnchor.current = itemRefs.current[index];
      setChild(item.id);
      return;
    }
    if (!item.keepOpen) close(true);
    item.onSelect?.();
  }
  function keyDown(event: KeyboardEvent) {
    event.stopPropagation();
    const at = reachable.indexOf(active);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setChild(null);
        setActive(reachable[(at + delta + reachable.length) % reachable.length] ?? -1);
        break;
      }
      case "Home":
      case "End":
        event.preventDefault();
        setChild(null);
        setActive((event.key === "Home" ? reachable[0] : reachable.at(-1)) ?? -1);
        break;
      case "ArrowRight":
        if (items[active]?.children) {
          event.preventDefault();
          select(items[active], active);
        }
        break;
      case "ArrowLeft":
        if (back) {
          event.preventDefault();
          back();
        }
        break;
      case "Escape":
        event.preventDefault();
        if (back) back();
        else close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }
  return (
    <div ref={popupRef} id={id} role="menu" aria-label={label} class="pk-menu__popup" onKeyDown={keyDown}>
      {heading && <p class="pk-menu__heading">{heading}</p>}
      {items.map((item, index) => {
        const shared = {
          key: item.id,
          ref: (element: HTMLButtonElement | HTMLAnchorElement | null) => {
            itemRefs.current[index] = element;
          },
          role: (item.checked === undefined ? "menuitem" : "menuitemradio") as "menuitem" | "menuitemradio",
          "aria-haspopup": item.children ? ("menu" as const) : undefined,
          "aria-expanded": item.children ? child === item.id : undefined,
          "aria-controls": item.children && child === item.id ? childId : undefined,
          "aria-checked": item.checked === undefined ? undefined : item.checked,
          tabIndex: index === active && !childItem ? 0 : -1,
          class: [
            "pk-menu__item",
            item.danger ? "pk-menu__item--danger" : null,
            item.checked !== undefined ? "pk-menu__item--choice" : null,
            item.separatorBefore ? "pk-menu__item--separated" : null,
          ]
            .filter(Boolean)
            .join(" "),
        };
        const content = (
          <>
            {item.checked !== undefined && (
              <span class="pk-menu__check" aria-hidden="true">
                {item.checked ? "✓" : ""}
              </span>
            )}
            {item.icon && (
              <span class="pk-menu__item-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
            {item.children && <span aria-hidden="true"> ›</span>}
          </>
        );
        return item.href ? (
          <a
            {...shared}
            href={item.href}
            aria-disabled={item.disabled ? "true" : undefined}
            onClick={(event) => {
              if (item.disabled) event.preventDefault();
              else close(false);
            }}
          >
            {content}
          </a>
        ) : (
          <button {...shared} type="button" disabled={item.disabled} onClick={() => select(item, index)}>
            {content}
          </button>
        );
      })}
      {childItem?.children && (
        <MenuLevel
          id={childId}
          label={childItem.label}
          items={childItem.children}
          anchorRef={childAnchor}
          close={close}
          back={() => setChild(null)}
        />
      )}
    </div>
  );
}
