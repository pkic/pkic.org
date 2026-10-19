import { render } from "preact";
import { IconFilter } from "../ui/MediaIcons";
import { Menu, type MenuItem } from "../ui/Menu";

/** The existing menu commands the original agenda controls and their canonical bindings. */
export function mountAgendaToolbarMenu(root: HTMLElement): () => void {
  const host = root.querySelector<HTMLElement>("[data-agenda-secondary-menu]");
  if (!host) return () => {};
  const selectors = [
    "[data-agenda-filters-toggle]",
    "[data-agenda-editor-controls] button",
    "[data-agenda-scroll]",
    "[data-agenda-compact]",
    "[data-agenda-expand]",
    "[data-agenda-print]",
    "[data-agenda-mine-filter]",
  ];
  const update = () => {
    const controls = selectors.flatMap((selector) => [...root.querySelectorAll<HTMLButtonElement>(selector)]);
    const items: MenuItem[] = controls.map((button, index) => ({
      id: String(index),
      label: button.title || button.getAttribute("aria-label") || button.textContent?.trim() || "Agenda action",
      checked: button.hasAttribute("aria-pressed") ? button.getAttribute("aria-pressed") === "true" : undefined,
      disabled: button.disabled,
      onSelect: () => button.click(),
    }));
    render(
      <Menu label="Agenda filters and actions" items={items} align="end">
        <IconFilter />
      </Menu>,
      host,
    );
  };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !host.contains(record.target))) update();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-pressed", "aria-label", "title", "disabled"],
  });
  update();
  return () => {
    observer.disconnect();
    render(null, host);
  };
}
