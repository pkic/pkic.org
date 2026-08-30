import { Link } from "wouter";

export interface TabItem {
  key: string;
  label: string;
  panelId?: string;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  idPrefix?: string;
  /**
   * When set, tabs render as real links (`hrefFor(key)`), so a tab position
   * is shareable and back-button safe; onChange still fires for callers that
   * navigate programmatically. Without it, tabs stay button-driven.
   */
  hrefFor?: (key: string) => string;
}

export function Tabs({ items, active, onChange, className = "mb-3", idPrefix, hrefFor }: TabsProps) {
  function selectFromKeyboard(current: HTMLElement, nextIndex: number): void {
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.key);
    const tabList = current.closest<HTMLElement>("[role='tablist']");
    const buttons = tabList?.querySelectorAll<HTMLElement>("[role='tab']");
    requestAnimationFrame(() => buttons?.[nextIndex]?.focus({ preventScroll: true }));
  }

  return (
    <ul class={`nav nav-tabs ${className}`} role="tablist">
      {items.map((item, index) => {
        const sharedProps = {
          class: `nav-link${active === item.key ? " active" : ""}`,
          role: "tab" as const,
          id: idPrefix ? `${idPrefix}-${item.key}` : undefined,
          "aria-selected": active === item.key,
          "aria-controls": item.panelId,
          tabIndex: active === item.key ? 0 : -1,
          onKeyDown: (event: KeyboardEvent) => {
            const current = event.currentTarget as HTMLElement;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              selectFromKeyboard(current, (index - 1 + items.length) % items.length);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              selectFromKeyboard(current, (index + 1) % items.length);
            } else if (event.key === "Home") {
              event.preventDefault();
              selectFromKeyboard(current, 0);
            } else if (event.key === "End") {
              event.preventDefault();
              selectFromKeyboard(current, items.length - 1);
            }
          },
        };
        return (
          <li key={item.key} class="nav-item" role="presentation">
            {hrefFor ? (
              <Link {...sharedProps} href={hrefFor(item.key)} onClick={() => onChange(item.key)}>
                {item.label}
              </Link>
            ) : (
              <button {...sharedProps} type="button" onClick={() => onChange(item.key)}>
                {item.label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
