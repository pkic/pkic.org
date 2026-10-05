// @vitest-environment jsdom
import { render, renderToStringAsync } from "preact-render-to-string";
import { render as mount } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
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
  it.each([false, true])("keeps native footers and occupied boundary cells in editor=%s cards", async (editing) => {
    const fixture = structuredClone(days);
    const day = fixture[0];
    day.locations.push({ id: "parallel", label: "Parallel hall" });
    const slot = day.slots[0];
    slot.startsAt = "2026-12-01T09:15:00.000Z";
    slot.time = "10:15";
    const session = slot.sessions[0];
    Object.assign(session, {
      id: "canonical-session",
      title:
        "A practical roadmap for cryptographic agility: coordinating infrastructure, application teams, and standards through a multi-year transition",
      descriptionHtml: "",
      descriptionMarkdown: "**Practical lessons** from cryptographic transitions.",
      durationMinutes: 45,
      endsAt: "2026-12-01T10:00:00.000Z",
      sessionUrl: "/sessions/canonical-session/",
      participation: { label: "Save preference", url: "/portal/events/example", message: "Save this session" },
    });
    day.slots = [
      {
        startsAt: "2026-12-01T09:00:00.000Z",
        time: "10:00",
        sessions: [
          {
            ...structuredClone(session),
            id: "parallel-session",
            title: "Parallel session",
            locations: ["parallel"],
            durationMinutes: 30,
            endsAt: "2026-12-01T09:30:00.000Z",
          },
        ],
      },
      slot,
      { startsAt: "2026-12-01T09:30:00.000Z", time: "10:30", sessions: [] },
      { startsAt: "2026-12-01T10:00:00.000Z", time: "11:00", sessions: [] },
    ];
    const host = document.createElement("div");
    host.innerHTML = await renderToStringAsync(
      <ContentAgenda
        days={fixture}
        speakers={[moderator]}
        timeZone="Europe/Amsterdam"
        editor={editing ? { session: () => ({ controls: null }), dropTarget: () => null } : undefined}
      />,
    );
    const article = host.querySelector('article[data-agenda-occurrence="canonical-session"]')!;
    const body = article.querySelector(".pk-content-agenda__session-body")!;
    expect(body.querySelector("h3")?.textContent).toBe(session.title);
    expect(body.querySelector(".pk-content-agenda__description")?.textContent).toContain("Practical lessons");
    for (const [label, href] of [
      ["Session page", session.sessionUrl],
      ["Download slides", session.presentationUrl],
      ...(!editing ? [[session.participation!.label, session.participation!.url]] : []),
    ]) {
      const link = [...article.querySelectorAll(".pk-content-agenda__actions a")].find(
        (item) => item.textContent?.trim() === label,
      )!;
      expect(link).toBeDefined();
      expect(link.getAttribute("href")).toBe(href);
      expect(body.contains(link)).toBe(false);
      expect(link.closest("article")).toBe(article);
    }
    if (editing)
      expect(
        [...article.querySelectorAll(".pk-content-agenda__actions a")].map((link) => link.textContent?.trim()),
      ).not.toContain(session.participation!.label);
    expect(article.querySelector(".pk-content-agenda__duration")?.textContent).toContain("45 min");
    expect(article.closest("td")?.rowSpan).toBe(2);
    const rows = [...host.querySelectorAll("tr.pk-content-agenda__slot")];
    const boundary = rows.find(
      (row) => row.querySelector("th time")?.getAttribute("datetime") === "2026-12-01T09:30:00.000Z",
    )!;
    expect(boundary.querySelector('td[data-agenda-cell="blue"]')).toBeNull();
    expect(boundary.querySelector('td[data-agenda-cell="parallel"]')).not.toBeNull();
    expect(boundary.querySelector("td[colspan]")).toBeNull();
    expect(rows.some((row) => row.querySelector("th time")?.getAttribute("datetime") === session.endsAt)).toBe(true);
    expect(host.querySelectorAll('article[data-agenda-occurrence="canonical-session"]')).toHaveLength(1);
  });

  it("forwards native drag completion to the editor without changing session identity", async () => {
    const fixture = structuredClone(days);
    fixture[0].slots[0].sessions[0].id = "canonical-session";
    const onDragEnd = vi.fn();
    const container = document.createElement("div");
    await act(() =>
      mount(
        <ContentAgenda
          days={fixture}
          speakers={[]}
          timeZone="Europe/Amsterdam"
          editor={{
            session: () => ({ controls: null, onDragStart: () => undefined, onDragEnd }),
            dropTarget: () => null,
          }}
        />,
        container,
      ),
    );
    const card = container.querySelector('[data-agenda-occurrence="canonical-session"]')!;
    await act(() => {
      card.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(card.getAttribute("draggable")).toBe("true");
    await act(() => mount(null, container));
  });

  it("renders one canonical session in each reserved room with independent detail targets", () => {
    const multi = structuredClone(days);
    multi[0].locations.push({ id: "overflow", label: "Overflow hall" });
    multi[0].slots[0].sessions[0].id = "canonical-session";
    multi[0].slots[0].sessions[0].locations = ["overflow", "blue"];
    multi[0].slots[0].sessions[0].publicAnchor = "legacy-talk:2024";
    const content = document.createElement("div");
    content.innerHTML = render(<ContentAgenda days={multi} speakers={[]} timeZone="Europe/Amsterdam" />);
    const cards = content.querySelectorAll('[data-agenda-occurrence="canonical-session"]');
    expect(cards).toHaveLength(2);
    expect(content.querySelectorAll('[id="legacy-talk:2024"]')).toHaveLength(1);
    expect(content.querySelector('[id="legacy-talk:2024"]')?.closest("td")?.getAttribute("data-agenda-cell")).toBe(
      "overflow",
    );
    expect([...cards].map((card) => card.closest("td")?.getAttribute("data-agenda-cell"))).toEqual([
      "blue",
      "overflow",
    ]);
    const targets = [...cards].map(
      (card) => card.querySelector<HTMLElement>("[data-agenda-open-session]")!.dataset.agendaOpenSession,
    );
    expect(new Set(targets).size).toBe(2);
    for (const target of targets) expect(content.querySelector(`dialog[id="${target}"]`)).not.toBeNull();
    expect(content.querySelector("[data-agenda-session-controls]")).toBeNull();
  });

  it("keeps venue time explicit and hides viewer time until it can be localized", () => {
    const content = agenda();
    const eventClock = content.querySelector('[aria-label="Event time"]')!;
    expect(eventClock.textContent).toContain("11:45");
    expect(eventClock.textContent).toContain("Event · Amsterdam");
    expect(eventClock.querySelector("time")?.getAttribute("datetime")).toBe("2026-12-01T10:45:00.000Z");
    expect(content.querySelector('[aria-label="Your time"]')?.hasAttribute("hidden")).toBe(true);
    expect(content.querySelector("[data-agenda-controls]")?.hasAttribute("hidden")).toBe(true);
    expect(content.querySelector("[data-agenda-time-choice]")?.hasAttribute("hidden")).toBe(true);
    expect(content.querySelector('[aria-label="Agenda time display"]')).not.toBeNull();
    expect(content.querySelector<HTMLElement>(".pk-content-agenda")?.dataset.agendaTimeDisplay).toBe("venue");
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
  it("supports generic recording links while retaining the existing YouTube embed", () => {
    const generic = structuredClone(days);
    generic[0].slots[0].sessions[0].youtube = undefined;
    generic[0].slots[0].sessions[0].recordingUrl = "https://media.example.test/session";
    const container = document.createElement("div");
    container.innerHTML = render(<ContentAgenda days={generic} speakers={[]} timeZone="Europe/Amsterdam" />);
    const recording = container.querySelector<HTMLAnchorElement>('a[href="https://media.example.test/session"]')!;
    expect(recording.textContent).toContain("Watch recording");
    expect(recording.rel).toContain("noopener");
    expect(recording.rel).toContain("noreferrer");
    expect(container.querySelector("iframe")).toBeNull();
    expect(agenda().querySelector("iframe")).not.toBeNull();
  });
  it("does not render recording links with executable schemes", () => {
    const unsafe = structuredClone(days);
    unsafe[0].slots[0].sessions[0].youtube = undefined;
    unsafe[0].slots[0].sessions[0].recordingUrl = "javascript:alert(1)";
    const output = render(<ContentAgenda days={unsafe} speakers={[]} timeZone="Europe/Amsterdam" />);
    expect(output).not.toContain("javascript:");
  });
});

it("renders supplied staffing track scope beside its location", () => {
  const source: ContentAgendaDay[] = [
    {
      ...days[0],
      staffing: [
        {
          id: "track-block",
          name: "Program duties",
          startAt: "2026-12-01T10:00:00.000Z",
          endAt: "2026-12-01T11:00:00.000Z",
          locationId: "blue",
          track: "Cryptography",
          duties: [{ role: "mc", displayName: "Synthetic Moderator" }],
        },
      ],
    },
  ];
  const output = render(<ContentAgenda days={source} speakers={[]} timeZone="Europe/Amsterdam" />);
  expect(output).toContain("Blue hall");
  expect(output).toContain("Track: Cryptography");
  expect(output).toContain("Synthetic Moderator");
  delete source[0].staffing![0].track;
  expect(render(<ContentAgenda days={source} speakers={[]} timeZone="Europe/Amsterdam" />)).not.toContain("Track:");
});

it("keeps the shared editor on venue time without a browser-choice control", () => {
  const output = render(
    <ContentAgenda
      days={days}
      speakers={[]}
      timeZone="Europe/Amsterdam"
      editor={{ session: () => ({ controls: null }), dropTarget: () => null }}
    />,
  );
  const container = document.createElement("div");
  container.innerHTML = output;
  expect(container.querySelector('[data-agenda-clock="venue"]')?.textContent).toContain("11:45");
  expect(container.querySelector('[data-agenda-clock="browser"]')).toBeNull();
  expect(container.querySelector("[data-agenda-time-choice]")).toBeNull();
});
