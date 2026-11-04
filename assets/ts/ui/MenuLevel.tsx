import type { RefObject } from "preact";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { MenuItem } from "./Menu";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePopupPlacement } from "./popup-placement";

/** Desktop submenus adjoin their parent; phone submenus replace it and provide Back navigation. */
export function MenuLevel({
  id,
  label,
  items: suppliedItems,
  heading,
  anchorRef,
  align = "start",
  initialLast = false,
  anchorPoint,
  close,
  back,
  beforePlace,
}: {
  id: string;
  label: string;
  items: readonly MenuItem[];
  heading?: string;
  anchorRef: RefObject<HTMLElement>;
  align?: "start" | "end";
  initialLast?: boolean;
  anchorPoint?: { x: number; y: number } | null;
  close: (returnFocus: boolean) => void;
  back?: () => void;
  beforePlace?: () => void;
}) {
  const compact = useMediaQuery("(max-width: 40rem)");
  const items: readonly MenuItem[] =
    compact && back
      ? [
          { id: "menu-back", label: "Back", icon: <span aria-hidden="true">‹</span>, onSelect: back, keepOpen: true },
          ...suppliedItems,
        ]
      : suppliedItems;
  const compactPoint = useCallback(() => {
    const bounds = anchorRef.current?.closest('[role="menu"]')?.getBoundingClientRect();
    return bounds ? { x: bounds.left, y: bounds.top - 4 } : null;
  }, [anchorRef]);
  const childId = useId();
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | HTMLAnchorElement | null)[]>([]);
  const childAnchor = useRef<HTMLElement>(null);
  const reachable = items.flatMap((item, index) => (item.disabled ? [] : [index]));
  const reachableKey = reachable.join(",");
  const [active, setActive] = useState((initialLast ? reachable.at(-1) : reachable[0]) ?? -1);
  const [child, setChild] = useState<string | null>(null);
  const childItem = items.find((item) => item.id === child && !item.disabled);
  const revision = items.map((item) => `${item.id}:${Boolean(item.disabled)}`).join("|");
  const place = usePopupPlacement({
    open: true,
    anchorRef,
    popupRef,
    align,
    side:
      back && !compact
        ? (anchorRef.current?.getBoundingClientRect().left ?? 0) > window.innerWidth / 2
          ? "left"
          : "right"
        : "bottom",
    spacing: back && !compact ? { gap: 4, crossAxis: -4 } : undefined,
    revision,
    topLayer: true,
    anchorPoint: compact && back ? compactPoint : anchorPoint,
    beforePlace,
  });
  useLayoutEffect(() => {
    if (childItem) return;
    const currentReachable = reachableKey ? reachableKey.split(",").map(Number) : [];
    if (!currentReachable.length) {
      popupRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!currentReachable.includes(active)) {
      setActive(currentReachable[0] ?? -1);
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
  }, [active, revision, childItem, reachableKey]);
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
    <div
      ref={popupRef}
      id={id}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      class={[
        "pk-menu__popup",
        compact ? "pk-menu__popup--compact" : "",
        compact && childItem ? "pk-menu__popup--drilled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={keyDown}
    >
      {compact && back && <div class="pk-menu__heading">{label}</div>}
      {heading && <p class="pk-menu__heading">{heading}</p>}
      {items.map((item, index) => {
        const shared = {
          key: item.id,
          ref: (element: HTMLButtonElement | HTMLAnchorElement | null) => {
            itemRefs.current[index] = element;
          },
          role: (item.checked === undefined ? "menuitem" : item.multiple ? "menuitemcheckbox" : "menuitemradio") as
            | "menuitem"
            | "menuitemcheckbox"
            | "menuitemradio",
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
        return item.href && !item.disabled ? (
          <a {...shared} href={item.href} onClick={() => close(false)}>
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
          beforePlace={place}
        />
      )}
    </div>
  );
}
