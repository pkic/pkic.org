// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import {
  initializeAgendaFilters,
  showDefaultLocations,
  showsDefaultLocations,
} from "../../assets/ts/site/agenda-filters";
import { mountAgendaToolbarMenu } from "../../assets/ts/site/agenda-toolbar-menu";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** An agenda beside something else, as in the virtual room, with two locations on its one day. */
function mount(phone = false, focus?: string) {
  vi.stubGlobal("matchMedia", () => ({ matches: phone }));
  const root = document.createElement("section");
  root.dataset.agendaView = "list";
  if (focus) root.dataset.agendaFocusLocation = focus;
  root.setAttribute("data-agenda-view-follows-locations", "");
  root.innerHTML = `<button data-agenda-view="grid">Grid</button><button data-agenda-view="list">List</button>
    <div data-agenda-location-day="one"><input type="checkbox" checked data-agenda-location="hall"><input type="checkbox" checked data-agenda-location="studio"></div>
    <div data-agenda-location-day="two" hidden><input type="checkbox" checked data-agenda-location="studio"><input type="checkbox" checked data-agenda-location="foyer"></div>
    <button data-agenda-clear-filters title="Clear filters" hidden></button><div data-agenda-secondary-menu></div>
    <section data-agenda-panel="one"><article data-agenda-session="hall"></article><article data-agenda-session="studio"></article></section>`;
  document.body.append(root);
  if (focus) showDefaultLocations(root);
  dispose = initializeAgendaFilters(root);
  const choose = (id: string, checked: boolean) => {
    const input = root.querySelector<HTMLInputElement>(`[data-agenda-location="${id}"]`)!;
    input.checked = checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const pressed = () => root.querySelector<HTMLElement>('[aria-pressed="true"]')?.dataset.agendaView;
  return { root, choose, pressed };
}

it("sets several locations side by side and lists one, until the reader picks a view", () => {
  const { root, choose, pressed } = mount();
  expect(root.dataset.agendaView).toBe("grid");
  expect(pressed()).toBe("grid");
  choose("studio", false);
  expect(root.dataset.agendaView).toBe("list");
  expect(pressed()).toBe("list");
  choose("studio", true);
  expect(root.dataset.agendaView).toBe("grid");
  // The reader's own choice holds whatever locations they pick next.
  root.querySelector<HTMLButtonElement>('[data-agenda-view="list"]')!.click();
  choose("studio", false);
  choose("studio", true);
  expect(root.dataset.agendaView).toBe("list");
});

it("lists every location on a phone", () => {
  const { root } = mount(true);
  expect(root.dataset.agendaView).toBe("list");
});

it("opens beside a location on its sessions, marks the filter, and clears to every location", () => {
  const { root } = mount(false, "hall");
  const checked = () =>
    [...root.querySelectorAll<HTMLInputElement>("[data-agenda-location]")].map((input) => input.checked);
  // A day without the location shows all of its locations.
  expect(checked()).toEqual([true, false, true, true]);
  expect(showsDefaultLocations(root)).toBe(true);
  expect(root.dataset.agendaView).toBe("list");
  expect(root.hasAttribute("data-agenda-filtered")).toBe(true);
  expect(root.querySelector<HTMLButtonElement>("[data-agenda-clear-filters]")!.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>("[data-agenda-clear-filters]")!.click();
  expect(checked()).toEqual([true, true, true, true]);
  expect(showsDefaultLocations(root)).toBe(false);
  expect(root.hasAttribute("data-agenda-filtered")).toBe(false);
  expect(root.dataset.agendaView).toBe("grid");
});

it("offers Clear filters first in the folded toolbar menu while a filter is on", async () => {
  const { root } = mount(false, "hall");
  const disposeMenu = mountAgendaToolbarMenu(root);
  const trigger = () => root.querySelector<HTMLButtonElement>("[data-agenda-secondary-menu] .pk-menu__trigger")!;
  expect(trigger().getAttribute("aria-label")).toBe("Agenda filters and actions, filters on");
  await act(async () => trigger().click());
  const items = () => [...document.querySelectorAll(".pk-menu__item")].map((item) => item.textContent);
  expect(items()[0]).toBe("Clear filters");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".pk-menu__item")][0]!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(trigger().getAttribute("aria-label")).toBe("Agenda filters and actions");
  await act(async () => trigger().click());
  expect(items()).not.toContain("Clear filters");
  disposeMenu();
});
