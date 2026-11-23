import { render } from "preact";
import { IconFilter } from "../ui/MediaIcons";
import { Menu, type MenuItem } from "../ui/Menu";

/** The existing menu commands the original agenda controls and their canonical bindings. */
export function mountAgendaToolbarMenu(root: HTMLElement): () => void {
  const host = root.querySelector<HTMLElement>("[data-agenda-secondary-menu]");
  if (!host) return () => {};
  const selectors = [
    "[data-agenda-clear-filters]",
    "[data-agenda-filters-toggle]",
    "[data-agenda-editor-controls] button",
    "[data-agenda-scroll]",
    "[data-agenda-compact]",
    "[data-agenda-expand]",
    "[data-agenda-print]",
    "[data-agenda-mine-filter]",
  ];
  const update = () => {
    // Clear filters is offered only while a filter hides sessions, and stands apart from the other actions.
    const controls = selectors.flatMap((selector) =>
      [...root.querySelectorAll<HTMLButtonElement>(selector)].filter((button) => !button.hidden),
    );
    const filtered = root.hasAttribute("data-agenda-filtered");
    const items: MenuItem[] = controls.map((button, index) => ({
      id: String(index),
      label: button.title || button.getAttribute("aria-label") || button.textContent?.trim() || "Agenda action",
      // A pressed button is an on/off setting: a checkbox in the menu, its check mark saying it is on.
      checked: button.hasAttribute("aria-pressed") ? button.getAttribute("aria-pressed") === "true" : undefined,
      multiple: button.hasAttribute("aria-pressed"),
      disabled: button.disabled,
      onSelect: () => button.click(),
      separatorBefore: index === 1 && controls[0]!.matches("[data-agenda-clear-filters]"),
    }));
    render(
      <Menu
        label={filtered ? "Agenda filters and actions, filters on" : "Agenda filters and actions"}
        items={items}
        align="end"
      >
        <IconFilter />
      </Menu>,
      host,
    );
  };
  const observer = new MutationObserver((records) => {
    // Cards hide and show with every filter change; of those, only the Clear filters button changes the menu.
    const relevant = (record: MutationRecord) =>
      !host.contains(record.target) &&
      (record.attributeName !== "hidden" ||
        (record.target instanceof Element && record.target.matches("[data-agenda-clear-filters]")));
    if (records.some(relevant)) update();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-pressed", "aria-label", "title", "disabled", "hidden", "data-agenda-filtered"],
  });
  update();
  return () => {
    observer.disconnect();
    render(null, host);
  };
}
