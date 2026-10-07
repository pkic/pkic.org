// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { expect, it } from "vitest";
import type { ContentAgendaDay } from "../../assets/shared/site-agenda";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";

function fixture(): ContentAgendaDay[] {
  return [
    {
      date: "2025-01-16",
      legacyFragments: [
        { anchor: "nav-thursday", kind: "day" },
        { anchor: "nav-thursday-tab", kind: "day_tab" },
      ],
      locations: [
        { id: "main", label: "Main room" },
        { id: "overflow", label: "Overflow room" },
      ],
      slots: [
        {
          startsAt: "2025-01-16T09:00:00.000Z",
          time: "09:00",
          sessions: [
            {
              id: "canonical-session",
              publicAnchor: "retained-primary",
              title: "An edited title",
              descriptionHtml: "Description",
              endsAt: "2025-01-16T10:00:00.000Z",
              locations: ["main", "overflow"],
              speakers: [],
              legacyFragments: [
                { anchor: "sessionModal-900-0-original/title", kind: "dialog", roomId: "main" },
                { anchor: "sessionModal-900-0-original/title-label", kind: "dialog_label", roomId: "main" },
                { anchor: "sessionModal-900-1-original/title", kind: "dialog", roomId: "overflow" },
                { anchor: "sessionModal-900-1-original/title-label", kind: "dialog_label", roomId: "overflow" },
              ],
            },
          ],
        },
      ],
    },
  ];
}
function documentFor(days: ContentAgendaDay[], publicPage = true) {
  const host = document.createElement("div");
  host.innerHTML = render(
    <ContentAgenda
      days={days}
      speakers={[]}
      timeZone="America/Chicago"
      fragmentNavigation={publicPage}
      legacySpeakerFragments={[
        { anchor: "speakers", kind: "speakers" },
        { anchor: "nav-speakers", kind: "speakers_tab" },
      ]}
    />,
  );
  return host;
}
it("emits exact authored room-specific modal and label aliases once alongside native targets", () => {
  const days = fixture();
  const host = documentFor(days);
  for (const fragment of days[0]!.slots[0]!.sessions[0]!.legacyFragments!) {
    const matches = [...host.querySelectorAll<HTMLElement>("[id]")].filter((node) => node.id === fragment.anchor);
    expect(matches).toHaveLength(1);
    const alias = matches[0]!;
    expect(alias.hidden).toBe(true);
    expect(alias.closest("td")?.getAttribute("data-agenda-cell")).toBe("main");
    expect(alias.closest("td")?.getAttribute("colspan")).toBe("2");
    const target = alias.dataset.agendaFragmentDialog!;
    expect([...host.querySelectorAll("dialog")].find((dialog) => dialog.id === target)).toBeDefined();
  }
  expect(host.querySelectorAll('[data-agenda-occurrence="canonical-session"]')).toHaveLength(1);
  expect(
    new Set(
      [...host.querySelectorAll<HTMLElement>("[data-agenda-fragment-dialog]")].map(
        (alias) => alias.dataset.agendaFragmentDialog,
      ),
    ).size,
  ).toBe(1);
  for (const id of ["nav-thursday", "nav-thursday-tab", "speakers", "nav-speakers", "retained-primary"])
    expect([...host.querySelectorAll("[id]")].filter((node) => node.id === id)).toHaveLength(1);
  expect(host.querySelector(".pk-content-agenda")!.hasAttribute("data-agenda-public-fragments")).toBe(true);
  expect(host.textContent).toContain("An edited title");
  expect([...host.querySelectorAll("[id]")].some((node) => node.id.includes("an-edited-title"))).toBe(false);
});
it("omits every ambiguous alias and aliases colliding with native or primary IDs", () => {
  const days = fixture(),
    session = days[0]!.slots[0]!.sessions[0]!;
  session.legacyFragments!.push(
    { anchor: "ambiguous", kind: "dialog", roomId: "main" },
    { anchor: "ambiguous", kind: "dialog", roomId: "overflow" },
    { anchor: "agenda-day-2025-01-16", kind: "dialog", roomId: "main" },
    { anchor: "agenda-session-2025-01-16-0-0-0-title", kind: "dialog", roomId: "main" },
    { anchor: "retained-primary", kind: "dialog", roomId: "main" },
  );
  const host = documentFor(days);
  expect(host.querySelector('[id="ambiguous"]')).toBeNull();
  expect(host.querySelector('[id="agenda-day-2025-01-16"]')!.tagName).toBe("SECTION");
  expect(host.querySelector('[id="agenda-session-2025-01-16-0-0-0-title"]')!.tagName).toBe("H2");
  expect(host.querySelector('[id="retained-primary"]')!.tagName).toBe("ARTICLE");
});
it("keeps identical aliases in portal preview without opting into global fragments", () => {
  const host = documentFor(fixture(), false);
  expect(host.querySelector('[id="sessionModal-900-0-original/title"]')).not.toBeNull();
  expect(host.querySelector(".pk-content-agenda")!.hasAttribute("data-agenda-public-fragments")).toBe(false);
});
