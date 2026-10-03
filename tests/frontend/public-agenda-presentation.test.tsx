// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import type { ContentAgendaDay, ContentAgendaSpeaker } from "../../assets/shared/site-agenda";

const moderator: ContentAgendaSpeaker = {
  name: "Synthetic Moderator",
  moderator: true,
  title: "Researcher, Example Organization",
  bioHtml: "<p>Researches cryptographic transitions.</p>",
  links: ["https://github.com/example"],
};
const days: ContentAgendaDay[] = [
  {
    date: "2026-12-01",
    locations: [{ id: "blue", label: "Blue hall" }],
    slots: [
      {
        startsAt: "2026-12-01T10:45:00.000Z",
        time: "11:45",
        sessions: [
          {
            title: "Synthetic transition session",
            descriptionHtml: "<p>Session abstract.</p>",
            durationMinutes: 30,
            endsAt: "2026-12-01T11:15:00.000Z",
            locations: ["blue"],
            speakers: [moderator],
            youtube: "example-video",
            presentationUrl: "/slides/example.pdf",
          },
        ],
      },
    ],
  },
];

function agenda(): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = render(<ContentAgenda days={days} speakers={[moderator]} timeZone="Europe/Amsterdam" />);
  return container;
}

describe("published agenda presentation", () => {
  it("keeps venue time explicit and hides viewer time until it can be localized", () => {
    const content = agenda();
    const eventClock = content.querySelector('[aria-label="Event time"]')!;
    expect(eventClock.textContent).toContain("11:45");
    expect(eventClock.textContent).toContain("Event · Amsterdam");
    expect(eventClock.querySelector("time")?.getAttribute("datetime")).toBe("2026-12-01T10:45:00.000Z");
    expect(content.querySelector('[aria-label="Your time"]')?.hasAttribute("hidden")).toBe(true);
    expect(content.querySelector("[data-agenda-controls]")?.hasAttribute("hidden")).toBe(true);
  });

  it("preserves moderator attribution, speaker links and slides in accessible session details", () => {
    const content = agenda();
    const opener = content.querySelector<HTMLButtonElement>("[data-agenda-open-session]")!;
    const dialog = content.querySelector("dialog")!;
    expect(opener.getAttribute("aria-label")).toBe("Open session details: Synthetic transition session");
    expect(dialog.id).toBe(opener.dataset.agendaOpenSession);
    expect(dialog.textContent).toContain("Moderator");
    expect(dialog.textContent).toContain("Researches cryptographic transitions.");
    expect(dialog.querySelector('a[href="https://github.com/example"]')?.getAttribute("aria-label")).toContain(
      "GitHub",
    );
    expect(content.querySelector('a[href="/slides/example.pdf"]')?.textContent).toContain("Download slides");
    expect(dialog.querySelector("iframe")?.hasAttribute("src")).toBe(false);
  });
});
