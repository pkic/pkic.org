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
}

export function Tabs({ items, active, onChange, className = "mb-3", idPrefix }: TabsProps) {
  function selectFromKeyboard(current: HTMLButtonElement, nextIndex: number): void {
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.key);
    const tabList = current.closest<HTMLElement>("[role='tablist']");
    const buttons = tabList?.querySelectorAll<HTMLButtonElement>("button[role='tab']");
    requestAnimationFrame(() => buttons?.[nextIndex]?.focus());
  }

  return (
    <ul class={`nav nav-tabs ${className}`} role="tablist">
      {items.map((item, index) => (
        <li key={item.key} class="nav-item" role="presentation">
          <button
            class={`nav-link${active === item.key ? " active" : ""}`}
            onClick={() => onChange(item.key)}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-${item.key}` : undefined}
            aria-selected={active === item.key}
            aria-controls={item.panelId}
            tabIndex={active === item.key ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                selectFromKeyboard(event.currentTarget, (index - 1 + items.length) % items.length);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                selectFromKeyboard(event.currentTarget, (index + 1) % items.length);
              } else if (event.key === "Home") {
                event.preventDefault();
                selectFromKeyboard(event.currentTarget, 0);
              } else if (event.key === "End") {
                event.preventDefault();
                selectFromKeyboard(event.currentTarget, items.length - 1);
              }
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
