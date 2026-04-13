import { h } from "preact";

export interface TabItem {
  key: string;
  label: string;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ items, active, onChange, className = "mb-3" }: TabsProps) {
  return (
    <ul class={`nav nav-tabs ${className}`} role="tablist">
      {items.map((item) => (
        <li key={item.key} class="nav-item" role="presentation">
          <button
            class={`nav-link${active === item.key ? " active" : ""}`}
            onClick={() => onChange(item.key)}
            type="button"
            role="tab"
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
