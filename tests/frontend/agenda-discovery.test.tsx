// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { initializeAgendaFilters, refreshAgendaFilters } from "../../assets/ts/site/agenda-filters";
import type { ContentAgendaDay } from "../../assets/shared/site-agenda";

const days: ContentAgendaDay[] = [
  {
    date: "2026-12-01",
    locations: [
      { id: "blue", label: "Blue hall" },
      { id: "green", label: "Green hall" },
    ],
    slots: [
      {
        startsAt: "2026-12-01T09:00:00.000Z",
        time: "10:00",
        sessions: [
          {
            id: "one",
            title: "Key transitions",
            kind: "session",
            track: "Technical",
            format: { id: "talk", label: "Talk" },
            locations: ["blue"],
            speakers: [{ name: "Alice Example", bioHtml: "<p>Unsearchable biography marker</p>" }],
            descriptionHtml: "",
            durationMinutes: 30,
          },
          {
            id: "two",
            title: "Policy discussion",
            kind: "plenary",
            track: "Policy",
            format: { id: "panel", label: "Panel" },
            locations: ["green"],
            speakers: [{ name: "Bob Example" }],
            descriptionHtml: "",
            durationMinutes: 30,
          },
        ],
      },
    ],
  },
  {
    date: "2026-12-02",
    locations: [{ id: "blue", label: "Blue hall" }],
    slots: [
      {
        startsAt: "2026-12-02T09:00:00.000Z",
        time: "10:00",
        sessions: [
          {
            id: "three",
            title: "Key transitions repeated",
            kind: "session",
            track: "Technical",
            format: { id: "talk", label: "Talk" },
            locations: ["blue"],
            speakers: [{ name: "Alice Example" }],
            descriptionHtml: "",
          },
        ],
      },
    ],
  },
];
let root: HTMLElement;
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.unstubAllGlobals();
});
function setup(source = days) {
  root.innerHTML = render(<ContentAgenda days={source} speakers={[]} timeZone="Europe/Amsterdam" />);
  for (const panel of root.querySelectorAll<HTMLElement>("[data-agenda-panel]"))
    panel.hidden = panel.dataset.agendaPanel !== source[0]!.date;
  dispose = initializeAgendaFilters(root.querySelector<HTMLElement>(".pk-content-agenda")!);
}
function input(selector: string, value: string) {
  const control = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
}
function card(id: string) {
  return root.querySelector<HTMLElement>(`[data-agenda-occurrence="${id}"]`)!;
}

it("keeps the full no-JS schedule and explicit day-owned native location targets", () => {
  root.innerHTML = render(<ContentAgenda days={days} speakers={[]} timeZone="Europe/Amsterdam" />);
  expect(root.querySelector("[data-agenda-controls]")?.hasAttribute("hidden")).toBe(true);
  expect([...root.querySelectorAll<HTMLElement>("[data-agenda-occurrence]")].every((item) => !item.hidden)).toBe(true);
  expect(root.querySelectorAll("[data-agenda-occurrence]")).toHaveLength(3);
  for (const day of days) {
    const group = root.querySelector(`[data-agenda-location-day="${day.date}"]`)!;
    const trigger = group.querySelector("[data-agenda-location-trigger]")!;
    const popup = group.querySelector("[popover='auto']")!;
    expect(trigger.getAttribute("popovertarget")).toBe(popup.id);
    expect(popup.getAttribute("role")).toBe("dialog");
    expect(popup.getAttribute("aria-label")).toBe("Filter locations");
  }
  expect(card("one").dataset.agendaSearchText).toBe("Key transitions Alice Example");
  expect(card("one").dataset.agendaSearchText).not.toContain("Unsearchable biography marker");
});

it("intersects actual room, format, track and supplied-speaker filters without crossing day ownership", () => {
  setup();
  expect(
    [...root.querySelectorAll<HTMLOptionElement>("[data-agenda-format-filter] option")].map((option) => option.text),
  ).toEqual(["All session types", "Talk", "Panel"]);
  input("[data-agenda-search]", "ALICE");
  input("[data-agenda-format-filter]", "talk");
  input("[data-agenda-track-filter]", "Technical");
  expect(card("one").hidden).toBe(false);
  expect(card("two").hidden).toBe(true);
  const first = root.querySelector<HTMLElement>('[data-agenda-location-day="2026-12-01"]')!;
  first.querySelector<HTMLInputElement>('[data-agenda-location="blue"]')!.click();
  expect(card("one").hidden).toBe(true);
  expect(first.querySelector("[data-agenda-location-label]")?.textContent).toBe("1 of 2 locations");
  expect(card("three").hidden).toBe(false);
  root.querySelector<HTMLElement>('[data-agenda-panel="2026-12-01"]')!.hidden = true;
  root.querySelector<HTMLElement>('[data-agenda-panel="2026-12-02"]')!.hidden = false;
  refreshAgendaFilters(root);
  expect(first.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('[data-agenda-location-day="2026-12-02"]')!.hidden).toBe(false);
  expect(card("three").hidden).toBe(false);
  root.querySelector<HTMLButtonElement>("[data-agenda-clear-filters]")!.click();
  expect(root.querySelector<HTMLInputElement>("[data-agenda-search]")!.value).toBe("");
  expect(root.querySelector<HTMLSelectElement>("[data-agenda-format-filter]")!.value).toBe("");
  expect(first.querySelector("[data-agenda-location-label]")?.textContent).toBe("1 of 2 locations");
  root.querySelector<HTMLElement>('[data-agenda-panel="2026-12-01"]')!.hidden = false;
  root.querySelector<HTMLElement>('[data-agenda-panel="2026-12-02"]')!.hidden = true;
  refreshAgendaFilters(root);
  expect(card("one").hidden).toBe(false);
  expect(card("two").hidden).toBe(false);
  expect(first.querySelector("[data-agenda-location-label]")?.textContent).toBe("All locations");
});

it("retains unassigned sessions when an event has no physical rooms", () => {
  const source = structuredClone(days.slice(0, 1));
  source[0]!.locations = [];
  source[0]!.slots[0]!.sessions = [{ ...source[0]!.slots[0]!.sessions[0]!, locations: [] }];
  const original = structuredClone(source);
  source[0]!.slots[0]!.sessions[0]!.publicAnchor = "unassigned-session";
  source[0]!.slots[0]!.sessions[0]!.legacyFragments = [{ anchor: "unassigned-legacy", kind: "dialog", roomId: null }];
  setup(source);
  expect(root.querySelector(".pk-content-agenda__location")?.textContent).toBe("Sessions");
  expect(root.querySelectorAll("col")).toHaveLength(2);
  expect(root.querySelector("[data-agenda-column-room]")).toBeNull();
  expect(root.querySelector("#unassigned-session")).not.toBeNull();
  expect(root.querySelector("#unassigned-legacy")).not.toBeNull();
  expect(source[0]!.locations).toEqual(original[0]!.locations);
  expect(source[0]!.slots[0]!.sessions[0]!.locations).toEqual([]);
  expect(card("one").hidden).toBe(false);
  input("[data-agenda-search]", "no matching session");
  expect(card("one").hidden).toBe(true);
  root.querySelector<HTMLButtonElement>("[data-agenda-clear-filters]")!.click();
  expect(card("one").hidden).toBe(false);
});

it("uses a phone list default, keeps stable cards across view changes, prints only on request and disposes listeners", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  setup();
  const original = card("one");
  expect(root.querySelector<HTMLElement>(".pk-content-agenda")!.dataset.agendaView).toBe("list");
  const grid = root.querySelector<HTMLButtonElement>('[data-agenda-view="grid"]')!;
  grid.click();
  expect(root.querySelector<HTMLElement>(".pk-content-agenda")!.dataset.agendaView).toBe("grid");
  expect(grid.getAttribute("aria-pressed")).toBe("true");
  expect(card("one")).toBe(original);
  expect(print).not.toHaveBeenCalled();
  root.querySelector<HTMLButtonElement>("[data-agenda-print]")!.click();
  expect(print).toHaveBeenCalledTimes(1);
  dispose!();
  input("[data-agenda-search]", "no matching session");
  expect(card("one").hidden).toBe(false);
  print.mockRestore();
});

it("folds phone filters behind a counted Filters toggle and keeps Clear filters working", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  setup();
  const agenda = root.querySelector<HTMLElement>(".pk-content-agenda")!;
  const toggle = root.querySelector<HTMLButtonElement>("[data-agenda-filters-toggle]")!;
  const count = root.querySelector<HTMLElement>("[data-agenda-filters-count]")!;
  expect(toggle.textContent).toContain("Filters");
  expect(toggle.getAttribute("aria-controls")).toBe("agenda-filter-controls");
  expect(root.querySelector(".pk-content-agenda__filter-controls")?.id).toBe("agenda-filter-controls");
  expect(agenda.dataset.agendaFilters).toBe("collapsed");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(count.hidden).toBe(true);
  toggle.click();
  expect(agenda.dataset.agendaFilters).toBe("expanded");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  input("[data-agenda-search]", "alice");
  input("[data-agenda-format-filter]", "talk");
  root
    .querySelector<HTMLInputElement>('[data-agenda-location-day="2026-12-01"] [data-agenda-location="blue"]')!
    .click();
  expect(count.hidden).toBe(false);
  expect(count.textContent).toBe("3");
  toggle.click();
  expect(agenda.dataset.agendaFilters).toBe("collapsed");
  expect(count.textContent).toBe("3");
  root.querySelector<HTMLButtonElement>("[data-agenda-clear-filters]")!.click();
  expect(count.hidden).toBe(true);
  expect(card("one").hidden).toBe(false);
  dispose!();
  dispose = undefined;
  expect(agenda.dataset.agendaFilters).toBeUndefined();
});

it("opens the phone filter row when a restored filter is already active, and leaves the editor toolbar alone", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  root.innerHTML = render(<ContentAgenda days={days} speakers={[]} timeZone="Europe/Amsterdam" />);
  for (const panel of root.querySelectorAll<HTMLElement>("[data-agenda-panel]"))
    panel.hidden = panel.dataset.agendaPanel !== days[0]!.date;
  root.querySelector<HTMLInputElement>("[data-agenda-search]")!.value = "policy";
  const agenda = root.querySelector<HTMLElement>(".pk-content-agenda")!;
  dispose = initializeAgendaFilters(agenda);
  expect(agenda.dataset.agendaFilters).toBe("expanded");
  expect(root.querySelector("[data-agenda-filters-toggle]")?.getAttribute("aria-expanded")).toBe("true");
  expect(root.querySelector<HTMLElement>("[data-agenda-filters-count]")!.textContent).toBe("1");
  dispose();
  dispose = undefined;
  root.innerHTML = render(
    <ContentAgenda
      days={days}
      speakers={[]}
      timeZone="UTC"
      editor={{ session: () => ({ controls: null }), dropTarget: () => null }}
    />,
  );
  const editor = root.querySelector<HTMLElement>(".pk-content-agenda")!;
  dispose = initializeAgendaFilters(editor);
  expect(root.querySelector("[data-agenda-filters-toggle]")).toBeNull();
  expect(root.querySelector(".pk-content-agenda__filter-controls")?.id).toBe("");
  expect(editor.dataset.agendaFilters).toBeUndefined();
  expect(editor.hasAttribute("data-agenda-today-focus")).toBe(false);
});

it("compresses real room columns while preserving multiroom cards, row spans and both global break forms", () => {
  const source: ContentAgendaDay[] = [
    {
      date: "2026-12-01",
      locations: [
        { id: "blue", label: "Blue" },
        { id: "green", label: "Green" },
        { id: "red", label: "Red" },
      ],
      slots: [
        {
          startsAt: "2026-12-01T09:00:00.000Z",
          time: "09:00",
          sessions: [
            {
              id: "shared",
              title: "Shared session",
              locations: ["blue", "green"],
              speakers: [],
              descriptionHtml: "",
              endsAt: "2026-12-01T09:30:00.000Z",
            },
            {
              id: "parallel",
              title: "Parallel session",
              locations: ["red"],
              speakers: [],
              descriptionHtml: "",
              endsAt: "2026-12-01T09:30:00.000Z",
            },
          ],
        },
        { startsAt: "2026-12-01T09:15:00.000Z", time: "09:15", sessions: [] },
        {
          startsAt: "2026-12-01T09:30:00.000Z",
          time: "09:30",
          sessions: [{ id: "break", title: "Coffee", kind: "break", locations: [], speakers: [], descriptionHtml: "" }],
        },
        { startsAt: "2026-12-01T10:00:00.000Z", time: "10:00", title: "Lunch", durationMinutes: 30, sessions: [] },
      ],
    },
  ];
  setup(source);
  const shared = card("shared");
  const cell = shared.closest("td")!;
  expect(cell.colSpan).toBe(2);
  expect(cell.rowSpan).toBe(2);
  const group = root.querySelector("[data-agenda-location-day]")!;
  const toggle = (id: string) => group.querySelector<HTMLInputElement>(`[data-agenda-location="${id}"]`)!.click();
  toggle("green");
  const table = root.querySelector("table")!;
  expect(table.querySelector<HTMLTableColElement>('col[data-agenda-column-room="green"]')!.hidden).toBe(true);
  expect(table.querySelector<HTMLTableCellElement>('th[data-agenda-column-room="green"]')!.hidden).toBe(true);
  expect(cell.colSpan).toBe(1);
  expect(cell.rowSpan).toBe(2);
  expect(card("shared")).toBe(shared);
  expect(card("shared").hidden).toBe(false);
  expect(card("parallel").closest("td")!.hidden).toBe(false);
  expect(card("break").hidden).toBe(false);
  expect(card("break").querySelector(".pk-content-agenda__room")).toBeNull();
  expect(card("parallel").querySelector(".pk-content-agenda__room")?.textContent).toContain("Red");
  expect(card("break").closest("td")!.colSpan).toBe(2);
  const lunch = [...table.querySelectorAll("td")].find((item) => item.textContent?.includes("Lunch"))!;
  expect(lunch.colSpan).toBe(2);
  toggle("blue");
  expect(cell.hidden).toBe(true);
  expect(cell.rowSpan).toBe(2);
  toggle("red");
  expect(card("break").hidden).toBe(true);
  expect(lunch.hidden).toBe(true);
  root.querySelector<HTMLButtonElement>("[data-agenda-clear-filters]")!.click();
  expect(cell.colSpan).toBe(2);
  expect(cell.hidden).toBe(false);
  expect(lunch.colSpan).toBe(3);
  expect(lunch.hidden).toBe(false);
});

it("prints original columns and all cards then restores screen filters without changing their choices", () => {
  setup();
  const group = root.querySelector('[data-agenda-location-day="2026-12-01"]')!;
  const blue = group.querySelector<HTMLInputElement>('[data-agenda-location="blue"]')!;
  blue.click();
  input("[data-agenda-search]", "no matches");
  const cell = card("one").closest("td")!;
  const column = root.querySelector<HTMLTableColElement>('col[data-agenda-column-room="blue"]')!;
  expect(cell.hidden).toBe(true);
  expect(column.hidden).toBe(true);
  expect(card("one").hidden).toBe(true);
  window.dispatchEvent(new Event("beforeprint"));
  expect(cell.hidden).toBe(false);
  expect(column.hidden).toBe(false);
  expect(card("one").hidden).toBe(false);
  expect(card("two").hidden).toBe(false);
  expect(card("three").hidden).toBe(false);
  expect(blue.checked).toBe(false);
  expect(root.querySelector<HTMLInputElement>("[data-agenda-search]")!.value).toBe("no matches");
  window.dispatchEvent(new Event("afterprint"));
  expect(cell.hidden).toBe(true);
  expect(column.hidden).toBe(true);
  expect(card("one").hidden).toBe(true);
  expect(card("two").hidden).toBe(true);
  expect(card("three").hidden).toBe(false);
});

it("keeps editor columns unchanged and keeps Add location beside a no-room display column", () => {
  root.innerHTML = render(
    <ContentAgenda
      days={days}
      speakers={[]}
      timeZone="UTC"
      editor={{
        addLocation: <button type="button">Add location</button>,
        session: () => ({ controls: null }),
        dropTarget: () => null,
      }}
    />,
  );
  dispose = initializeAgendaFilters(root.querySelector<HTMLElement>(".pk-content-agenda")!);
  root.querySelector<HTMLInputElement>('[data-agenda-location="blue"]')!.click();
  expect([...root.querySelectorAll<HTMLElement>("[data-agenda-column-room]")].every((item) => !item.hidden)).toBe(true);
  expect(root.querySelector("[data-agenda-filter-columns]")).toBeNull();
  dispose();
  const source = structuredClone(days.slice(0, 1));
  source[0]!.locations = [];
  source[0]!.slots[0]!.sessions[0]!.locations = [];
  root.innerHTML = render(
    <ContentAgenda
      days={source}
      speakers={[]}
      timeZone="UTC"
      editor={{
        addLocation: <button type="button">Add location</button>,
        session: () => ({ controls: null }),
        dropTarget: () => null,
      }}
    />,
  );
  expect(root.querySelectorAll("col")).toHaveLength(3);
  expect(root.querySelector("thead")?.textContent).toContain("Sessions");
  expect(root.querySelector("thead")?.textContent).toContain("Add location");
  expect(card("one")).not.toBeNull();
  expect(source[0]!.locations).toEqual([]);
});

it("searches actual day-owned checkbox rows without changing choices and exposes focusable native controls", () => {
  setup();
  const first = root.querySelector<HTMLElement>('[data-agenda-location-day="2026-12-01"]')!;
  const second = root.querySelector<HTMLElement>('[data-agenda-location-day="2026-12-02"]')!;
  const blue = first.querySelector<HTMLInputElement>('[data-agenda-location="blue"]')!;
  const green = first.querySelector<HTMLInputElement>('[data-agenda-location="green"]')!;
  expect(blue.type).toBe("checkbox");
  expect(blue.closest("label")?.textContent).toBe("Blue hall");
  expect(blue.getAttribute("aria-pressed")).toBeNull();
  expect(first.querySelectorAll("input[data-agenda-location]")).toHaveLength(2);
  expect(second.querySelectorAll("input[data-agenda-location]")).toHaveLength(1);
  blue.focus();
  expect(document.activeElement).toBe(blue);
  expect(blue.tabIndex).toBe(0);
  // Native checkbox activation emits input/change; no custom keyboard interception is needed.
  blue.click();
  expect(blue.checked).toBe(false);
  expect(card("one").hidden).toBe(true);
  input('[data-agenda-location-day="2026-12-01"] [data-agenda-location-search]', "GREEN");
  expect(blue.closest<HTMLElement>("label")!.hidden).toBe(true);
  expect(green.closest<HTMLElement>("label")!.hidden).toBe(false);
  expect(blue.checked).toBe(false);
  expect(green.checked).toBe(true);
  expect(card("two").hidden).toBe(false);
  expect(second.querySelector<HTMLInputElement>("[data-agenda-location-search]")!.value).toBe("");
  first.querySelector<HTMLButtonElement>('[data-agenda-locations-action="clear"]')!.click();
  expect(blue.checked).toBe(false);
  expect(green.checked).toBe(false);
  expect(card("one").hidden).toBe(true);
  expect(card("two").hidden).toBe(true);
  expect(second.querySelector<HTMLInputElement>("[data-agenda-location]")!.checked).toBe(true);
  first.querySelector<HTMLButtonElement>('[data-agenda-locations-action="all"]')!.click();
  expect(blue.checked).toBe(true);
  expect(green.checked).toBe(true);
  expect(card("one").hidden).toBe(false);
  expect(card("two").hidden).toBe(false);
  input('[data-agenda-location-day="2026-12-01"] [data-agenda-location-search]', "missing location");
  expect(first.querySelector<HTMLElement>("[data-agenda-location-empty]")!.hidden).toBe(false);
  expect(blue.checked).toBe(true);
  expect(green.checked).toBe(true);
  input('[data-agenda-location-day="2026-12-01"] [data-agenda-location-search]', "");
  expect(first.querySelector<HTMLElement>("[data-agenda-location-empty]")!.hidden).toBe(true);
  expect(blue.closest<HTMLElement>("label")!.hidden).toBe(false);
  expect(green.closest<HTMLElement>("label")!.hidden).toBe(false);
});
