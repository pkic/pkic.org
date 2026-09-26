/**
 * Breadcrumb — the trail to the current page.
 *
 * Renders as an ordered list. Items with href render as links, the last
 * item renders as plain text with aria-current="page". Separators are
 * CSS ::before content so screen readers do not read them.
 */

import "./Breadcrumb.css";

export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
}

export interface BreadcrumbProps {
  items: ReadonlyArray<BreadcrumbItem>;
  label?: string;
  class?: string;
}

export function Breadcrumb({ items, label = "Breadcrumb", class: className }: BreadcrumbProps) {
  const classes = ["pk-breadcrumb", className].filter(Boolean).join(" ");

  return (
    <nav class={classes} aria-label={label}>
      <ol class="pk-breadcrumb__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} class="pk-breadcrumb__item">
              {isLast ? (
                <span aria-current="page">{item.label}</span>
              ) : item.href ? (
                <a href={item.href} class="pk-breadcrumb__link">
                  {item.label}
                </a>
              ) : (
                <span>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
