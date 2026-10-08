// @vitest-environment jsdom
import { render, renderToStringAsync } from "preact-render-to-string";
import { render as mount } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { AgendaSession } from "../../assets/ts/site/AgendaSession";
import { eventParticipationLink } from "../../assets/shared/event-participation-link";
import { agendaContent } from "../../assets/shared/public-agenda-content";
import { agendaOccurrenceSchema } from "../../assets/shared/schemas/event-agenda";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import type { ContentAgendaDay, ContentAgendaSpeaker } from "../../assets/shared/site-agenda";
import { sessionRecordingPublicUrl } from "../../assets/shared/session-recording-public-url";

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
  it("shows each full biography in a speaker card in public and editor session details", () => {
    const day = days[0]!;
    const session = day.slots[0]!.sessions[0]!;
    for (const editor of [undefined, { controls: <span>Session actions</span> }]) {
      const host = document.createElement("div");
      host.innerHTML = render(
        <AgendaSession
          session={session}
          slot={day.slots[0]}
          locations={day.locations}
          dialogId="visible-speaker-details"
          timeZone="Europe/Amsterdam"
          editor={editor}
        />,
      );
      const dialog = host.querySelector("dialog")!;
      const speaker = dialog.querySelector(".speaker-card")!;
      expect(speaker).not.toBeNull();
      expect(speaker.textContent).toContain(moderator.name);
      expect(speaker.textContent).toContain(moderator.title);
      expect(speaker.querySelector(".pk-content-agenda__speaker-bio")?.textContent).toContain(
        "Researches cryptographic transitions.",
      );
      expect(dialog.querySelector("details, summary")).toBeNull();
      expect(speaker.querySelector("[hidden]")).toBeNull();
    }
  });
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
      participation: eventParticipationLink("example", "canonical-session", "reservation"),
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
    const opener = body.querySelector<HTMLElement>("[data-agenda-open-session]")!;
    expect(opener.getAttribute("aria-label")).toBe(`Open session details: ${session.title}`);
    expect(opener.tagName).toBe(editing ? "BUTTON" : "A");
    expect(opener.getAttribute("href")).toBe(editing ? null : session.sessionUrl);
    expect(article.querySelector(`dialog[id="${opener.dataset.agendaOpenSession}"]`)).not.toBeNull();
    expect(article.querySelector(".pk-content-agenda__actions")?.textContent).not.toContain("Session page");
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
    expect([...boundary.querySelectorAll("td")].every((cell) => cell.colSpan === 1)).toBe(true);
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

  it("renders adjacent reserved rooms as one card with its primary anchor and native detail target", () => {
    const multi = structuredClone(days);
    multi[0].locations.push({ id: "overflow", label: "Overflow hall" });
    multi[0].slots[0].sessions[0].id = "canonical-session";
    multi[0].slots[0].sessions[0].locations = ["overflow", "blue"];
    multi[0].slots[0].sessions[0].publicAnchor = "legacy-talk:2024";
    const content = document.createElement("div");
    content.innerHTML = render(<ContentAgenda days={multi} speakers={[]} timeZone="Europe/Amsterdam" />);
    const cards = content.querySelectorAll('[data-agenda-occurrence="canonical-session"]');
    expect(cards).toHaveLength(1);
    expect(content.querySelectorAll('[id="legacy-talk:2024"]')).toHaveLength(1);
    expect(content.querySelector('[id="legacy-talk:2024"]')?.closest("td")?.getAttribute("data-agenda-cell")).toBe(
      "blue",
    );
    expect(cards[0]?.closest("td")?.getAttribute("colspan")).toBe("2");
    const targets = [...cards].map(
      (card) => card.querySelector<HTMLElement>("[data-agenda-open-session]")!.dataset.agendaOpenSession,
    );
    expect(new Set(targets).size).toBe(1);
    for (const target of targets) expect(content.querySelector(`dialog[id="${target}"]`)).not.toBeNull();
    expect(content.querySelector("[data-agenda-session-controls]")).toBeNull();
  });

  it("keeps venue time explicit and hides viewer time until it can be localized", () => {
    const content = agenda();
    const eventClock = content.querySelector('[aria-label="Event time"]')!;
    expect(eventClock.textContent).toContain("11:45");
    expect(content.querySelector('.pk-content-agenda__time-heading small[title="Europe/Amsterdam"]')?.textContent).toBe(
      "Event · Amsterdam",
    );
    expect(eventClock.textContent).not.toContain("Amsterdam");
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

  it.each([false, true])(
    "embeds only approved owned recordings in the shared session dialog (editor=%s)",
    (editing) => {
      const fixture = structuredClone(days);
      const session = fixture[0]!.slots[0]!.sessions[0]!;
      session.id = "10000000-0000-4000-8000-000000000001";
      session.youtube = undefined;
      session.recordingApproved = true;
      session.recordingUrl = sessionRecordingPublicUrl({
        eventSlug: "recording-event",
        occurrenceId: session.id,
        materialId: "recording original",
        versionId: "10000000-0000-4000-8000-000000000002",
        digest: "a".repeat(64),
      });
      const host = document.createElement("div");
      const output = () =>
        render(
          <ContentAgenda
            days={fixture}
            speakers={[]}
            timeZone="Europe/Amsterdam"
            editor={editing ? { session: () => ({ controls: null }), dropTarget: () => null } : undefined}
          />,
        );
      host.innerHTML = output();
      const video = host.querySelector("dialog video")!;
      expect(video.getAttribute("src")).toBe(session.recordingUrl);
      expect(video.getAttribute("preload")).toBe("none");
      expect(video.hasAttribute("controls")).toBe(true);
      expect(video.hasAttribute("playsinline")).toBe(true);
      expect(video.hasAttribute("autoplay")).toBe(false);
      expect(host.querySelector("iframe")).toBeNull();
      const watch = host.querySelector<HTMLAnchorElement>("[data-agenda-watch-recording]")!;
      expect(watch.dataset.agendaOpenSession).toBe(video.closest("dialog")!.id);
      expect(watch.hasAttribute("target")).toBe(false);
      session.recordingApproved = false;
      host.innerHTML = output();
      expect(host.querySelector("video,iframe")).toBeNull();
      session.recordingApproved = true;
      for (const url of [
        "https://media.example.test/unknown.mp4",
        "/api/v1/events/recording-event/meetings/join?token=private",
      ]) {
        session.recordingUrl = url;
        host.innerHTML = output();
        expect(host.querySelector("video,iframe")).toBeNull();
      }
    },
  );

  it("pauses owned recording playback when the portal session dialog closes", async () => {
    const session = {
      ...days[0]!.slots[0]!.sessions[0]!,
      youtube: undefined,
      recordingApproved: true,
      recordingUrl: sessionRecordingPublicUrl({
        eventSlug: "recording-event",
        occurrenceId: "10000000-0000-4000-8000-000000000001",
        materialId: "recording",
        versionId: "10000000-0000-4000-8000-000000000002",
        digest: "a".repeat(64),
      }),
    };
    const host = document.createElement("div");
    document.body.append(host);
    try {
      await act(() =>
        mount(
          <AgendaSession
            session={session}
            locations={days[0]!.locations}
            dialogId="owned-playback"
            timeZone="Europe/Amsterdam"
            editor={{ controls: null }}
          />,
          host,
        ),
      );
      const video = host.querySelector("video")!;
      const pause = vi.fn();
      Object.defineProperty(video, "pause", { value: pause });
      await act(() => {
        host.querySelector("dialog")!.dispatchEvent(new Event("close"));
      });
      expect(pause).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => mount(null, host));
      host.remove();
    }
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

it("retains both shared editor clocks without a browser-choice control", () => {
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
  expect(container.querySelector('[data-agenda-clock="browser"]')).not.toBeNull();
  expect(container.querySelector("[data-agenda-time-zone]")?.getAttribute("data-agenda-time-zone")).toBe(
    "Europe/Amsterdam",
  );
  expect(container.querySelector("[data-agenda-time-choice]")).toBeNull();
});

it("preserves derived presentation and transition times while displaying one full-slot duration", async () => {
  const source = structuredClone(approvedAgendaSnapshot);
  const first = source.occurrences[0]!;
  first.endAt = "2026-12-01T09:30:00.000Z";
  source.rooms.push({ ...source.rooms[0]!, id: "second", name: "Second hall" });
  source.occurrences.push(
    ...["hall", "second"].map((roomId) =>
      agendaOccurrenceSchema.parse({
        id: `following-${roomId}`,
        title: `Following ${roomId}`,
        description: "Next presentation",
        startAt: first.endAt,
        endAt: "2026-12-01T10:00:00.000Z",
        roomId,
        speakers: [],
      }),
    ),
  );
  source.travelMinutes = 20;
  const captured = structuredClone(source);
  const content = agendaContent(source);
  const slot = content.days[0]!.slots[0]!;
  const session = slot.sessions[0]!;
  expect(session.durationMinutes).toBe(30);
  expect(session.contentDurationMinutes).toBe(25);
  expect(session.transitionMinutes).toBe(5);
  expect(session.endsAt).toBe("2026-12-01T09:30:00.000Z");
  const publicCard = document.createElement("div");
  publicCard.innerHTML = render(<ContentAgenda {...content} timeZone={source.timeZone} />);
  expect(publicCard.querySelectorAll(".pk-content-agenda__duration")).toHaveLength(3);
  expect(publicCard.querySelector(".pk-content-agenda__duration")?.textContent).toBe("30 min");
  const onDurationChange = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  try {
    await act(() =>
      mount(
        <AgendaSession
          session={session}
          slot={slot}
          locations={content.days[0]!.locations}
          dialogId="derived-time"
          timeZone={source.timeZone}
          editor={{ controls: null, onDurationChange }}
        />,
        host,
      ),
    );
    const duration = host.querySelector(".pk-content-agenda__duration");
    expect(host.querySelectorAll(".pk-content-agenda__duration")).toHaveLength(1);
    expect(duration?.textContent).toBe("30 min");
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Duration for Approved session"]');
    expect(trigger).not.toBeNull();
    await act(() => trigger!.click());
    const choice = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(
      // The shared Menu prefixes the checked choice with an aria-hidden checkmark.
      (item) => item.textContent?.replace(/^✓/, "").trim() === "30 minutes",
    );
    expect(choice).toBeDefined();
    expect(choice?.getAttribute("aria-checked")).toBe("true");
    await act(() => choice!.click());
    expect(onDurationChange).toHaveBeenCalledWith(30);
    expect(source).toEqual(captured);
  } finally {
    await act(() => mount(null, host));
    host.remove();
  }
});

it("does not derive public handover from a private next-session choice", () => {
  const source = structuredClone(approvedAgendaSnapshot);
  const first = source.occurrences[0]!;
  first.endAt = "2026-12-01T09:30:00.000Z";
  source.occurrences.push(
    ...["hall", "other"].map((roomId, index) =>
      agendaOccurrenceSchema.parse({
        id: `next-${roomId}`,
        title: "Following talk",
        description: "",
        startAt: first.endAt,
        endAt: "2026-12-01T10:00:00.000Z",
        roomId,
        visibility: index ? "private" : "public",
        speakers: [],
      }),
    ),
  );
  expect(agendaContent(source).days[0]!.slots[0]!.sessions[0]!.contentDurationMinutes).toBeUndefined();
  expect(agendaContent(source, true).days[0]!.slots[0]!.sessions[0]!.contentDurationMinutes).toBe(25);
});

it("renders an accessible outline preference star linking to authenticated participation without pretending it is saved", () => {
  const day = days[0]!;
  const session = {
    ...day.slots[0]!.sessions[0]!,
    participation: eventParticipationLink("workshop", "session-id", "preference"),
  };
  const host = document.createElement("div");
  host.innerHTML = render(
    <AgendaSession
      session={session}
      slot={day.slots[0]}
      locations={day.locations}
      dialogId="preference-detail"
      timeZone="Europe/Amsterdam"
    />,
  );
  const stars = host.querySelectorAll<HTMLAnchorElement>(`a[aria-label="Save favorite for ${session.title}"]`);
  expect(stars).toHaveLength(2);
  for (const star of stars) {
    expect(star.getAttribute("href")).toBe("/portal/#/events/workshop/agenda?session=session-id");
    expect(star.title).toContain("does not register you, reserve a place, or grant an invitation");
    expect(star.textContent).toBe("");
    expect(star.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(star.querySelector("path")?.getAttribute("fill")).toBe("none");
    expect(star.hasAttribute("aria-pressed")).toBe(false);
  }
});

it.each([
  ["reservation", "open", "Registration required", "Register for session"],
  ["optional_reservation", "open", "Registration optional", "Register if you wish"],
  ["approval", "open", "Approval required", "Request approval"],
  ["reservation", "invitation", "Invitation required", "Invitation required"],
] as const)(
  "keeps favorites separate from %s/%s registration on cards and details",
  (policy, access, policyLabel, actionLabel) => {
    const day = days[0]!;
    const session = {
      ...day.slots[0]!.sessions[0]!,
      participation: eventParticipationLink("workshop", "session-id", policy, access),
    };
    const host = document.createElement("div");
    host.innerHTML = render(
      <AgendaSession
        session={session}
        slot={day.slots[0]}
        locations={day.locations}
        dialogId="registration-detail"
        timeZone="Europe/Amsterdam"
      />,
    );
    expect(host.querySelectorAll(`a[aria-label="Save favorite for ${session.title}"]`)).toHaveLength(2);
    const registrations = [...host.querySelectorAll("a")].filter((link) => link.textContent === actionLabel);
    expect(registrations).toHaveLength(2);
    for (const link of registrations) expect(link.querySelector("svg")).toBeNull();
    expect(host.textContent).toContain(policyLabel);
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  },
);
