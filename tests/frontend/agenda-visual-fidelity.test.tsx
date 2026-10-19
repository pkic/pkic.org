// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { afterEach, expect, it, vi } from "vitest";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { AgendaSession } from "../../assets/ts/site/AgendaSession";
import { initializeAgendaSessionMedia } from "../../assets/ts/site/agenda-session-media";
import { initializeAgendaSpeakers } from "../../assets/ts/site/agenda-speakers";
import type { ContentAgendaDay } from "../../assets/shared/site-agenda";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function days(): ContentAgendaDay[] {
  const speaker = {
    speakerKey: "user:canonical-person",
    name: "Same display name",
    affiliations: [{ title: "Frozen employer A" }],
    bioMarkdown: "Frozen biography A",
    imageSrc: "/images/supplied-portrait.jpg",
  };
  return [
    {
      date: "2026-12-01",
      locations: [{ id: "hall", label: "Hall" }],
      slots: [
        {
          startsAt: "2026-12-01T09:00:00.000Z",
          time: "09:00",
          sessions: [
            {
              id: "first",
              title: "First occurrence",
              locations: ["hall"],
              speakers: [speaker],
              endsAt: "2026-12-01T09:30:00.000Z",
              descriptionMarkdown: "A real abstract.",
              descriptionHtml: "",
              sessionUrl: "/events/example/sessions/first/",
              durationMinutes: 30,
            },
          ],
        },
        {
          startsAt: "2026-12-01T10:00:00.000Z",
          time: "10:00",
          sessions: [
            {
              id: "second",
              title: "Repeated occurrence",
              locations: ["hall"],
              speakers: [
                {
                  ...speaker,
                  affiliations: [{ title: "Frozen employer B" }],
                  bioMarkdown: "Frozen biography B",
                  moderator: true,
                },
              ],
              endsAt: "2026-12-01T10:30:00.000Z",
              descriptionHtml: "",
              sessionUrl: "/events/example/sessions/second/",
            },
          ],
        },
        {
          startsAt: "2026-12-01T11:00:00.000Z",
          time: "11:00",
          sessions: [
            {
              id: "foreign",
              title: "Different source credit",
              locations: ["hall"],
              speakers: [{ ...speaker, speakerKey: "source:other-provenance" }],
              descriptionHtml: "",
              sessionUrl: "/events/example/sessions/foreign/",
            },
          ],
        },
      ],
    },
  ];
}
function mount(source = days()) {
  const root = document.createElement("div");
  root.innerHTML = render(
    <ContentAgenda days={source} speakers={source[0]!.slots[0]!.sessions[0]!.speakers} timeZone="UTC" />,
  );
  document.body.append(root);
  return root;
}
it("associates actual session links by supplied key in one profile per speaker, while each appearance keeps its frozen biography", () => {
  const source = days();
  source[0]!.slots[0]!.sessions[0]!.speakers[0]!.personPath = "/people/canonical-person/";
  const root = mount(source);
  // Every card and session details open the one profile rendered beside the program.
  expect(root.querySelectorAll("[data-agenda-occurrence] dialog[data-agenda-speaker-dialog]")).toHaveLength(0);
  const profiles = root.querySelectorAll<HTMLDialogElement>("[data-agenda-speaker-profiles] dialog");
  expect(profiles).toHaveLength(2);
  const profile = profiles[0]!;
  // Each appearance's own frozen biography stays in that session's details.
  const second = root.querySelector('[data-agenda-occurrence="second"] dialog.session-modal')!;
  expect(second.textContent).toContain("Frozen biography B");
  expect(profile.querySelector("a[href='/people/canonical-person/']")?.textContent).toBe("Full speaker profile");
  const portrait = profile.querySelector(".pk-agenda-speaker-profile__portrait .pk-avatar")!;
  expect(portrait.classList.contains("pk-avatar--square")).toBe(false);
  // The closed profile holds its portrait until it opens (deferred-images.ts).
  expect(portrait.querySelector("img")?.getAttribute("data-deferred-src")).toBe("/images/supplied-portrait.jpg");
  expect(profile.textContent).toContain("Frozen employer A");
  expect(profile.textContent).toContain("Frozen biography A");
  expect(profile.textContent).not.toContain("Frozen biography B");
  const sessionLinks = [...profile.querySelectorAll<HTMLAnchorElement>(".pk-agenda-speaker-profile__sessions a")];
  expect(sessionLinks.map((link) => link.getAttribute("href"))).toEqual([
    "/events/example/sessions/first/",
    "/events/example/sessions/second/",
  ]);
  // Inside the agenda each title opens that session's details in place.
  expect(sessionLinks.map((link) => link.dataset.agendaOpenOccurrence)).toEqual(["first", "second"]);
  expect(profile.textContent).not.toContain("Different source credit");
  expect(profile.textContent).toContain("Moderator");
  expect(profile.dataset.agendaSpeakerKey).toBe("user:canonical-person");
  expect(profiles[1]!.dataset.agendaSpeakerKey).toBe("source:other-provenance");
  // Provenance keys support stable bookmarks but remain outside the visible speaker credit.
  expect(root.textContent).not.toContain("user:canonical-person");
  expect(root.textContent).not.toContain("source:other-provenance");
  const ids = [...root.querySelectorAll("[id]")].map((element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
});
it("puts actual media actions before the abstract with no duplicate bottom actions or provider loading", () => {
  const source = days();
  source[0]!.slots[0]!.sessions[0]!.youtube = "dQw4w9WgXcQ";
  source[0]!.slots[0]!.sessions[0]!.recordingApproved = true;
  source[0]!.slots[0]!.sessions[0]!.presentationUrl = "/events/example/slides.pdf";
  const root = mount(source);
  const dialog = root.querySelector<HTMLDialogElement>("dialog.session-modal")!;
  const actions = dialog.querySelector(".session-modal__actions")!;
  expect(
    actions
      .querySelector("a[href='https://www.youtube.com/watch?v=dQw4w9WgXcQ']")
      ?.hasAttribute("data-agenda-media-recording"),
  ).toBe(true);
  const abstract = [...dialog.querySelectorAll("section")].find(
    (section) => section.querySelector("h3")?.textContent === "Abstract",
  )!;
  expect(actions.compareDocumentPosition(abstract) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(dialog.querySelectorAll("a[href='/events/example/slides.pdf']")).toHaveLength(1);
  expect(dialog.querySelector(".session-modal__footer a")).toBeNull();
  expect(dialog.querySelector("iframe")?.hasAttribute("src")).toBe(false);
  expect(dialog.querySelector("iframe")?.getAttribute("data-video-src")).not.toContain("autoplay");
  expect(dialog.querySelector(".session-modal__speaker .pk-content-agenda__speaker-bio")?.textContent).toContain(
    "Frozen biography A",
  );
  expect(dialog.querySelector("details, summary")).toBeNull();
});
it("derives upcoming/live strips from the existing timer and refuses unknown ends and breaks", () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-12-01T08:44:00.000Z");
  const source = days();
  source[0]!.slots[1]!.sessions[0]!.endsAt = undefined;
  source[0]!.slots[2]!.sessions[0]!.kind = "break";
  const root = mount(source);
  dispose = initializeAgendaSessionMedia(root);
  const status = root.querySelector<HTMLElement>('[data-agenda-occurrence="first"] [data-agenda-session-status]')!;
  expect(status.hidden).toBe(true);
  vi.advanceTimersByTime(60_000);
  expect(status.hidden).toBe(false);
  expect(status.querySelector("[data-agenda-status-label]")?.textContent).toBe("Starts in 15 min");
  // The upcoming band also names the start on the venue clock.
  expect(status.querySelector("[data-agenda-status-time]")?.textContent).toBe("09:00 UTC");
  vi.advanceTimersByTime(15 * 60_000);
  expect(status.dataset.agendaStatus).toBe("live");
  expect(status.textContent).toContain("30 min left");
  expect(
    root.querySelector<HTMLElement>('[data-agenda-occurrence="second"] [data-agenda-session-status]')!.hidden,
  ).toBe(true);
  expect(root.querySelector('[data-agenda-occurrence="foreign"] [data-agenda-session-status]')).toBeNull();
  vi.advanceTimersByTime(30 * 60_000);
  expect(status.hidden).toBe(true);
});
it("opens the speaker's profile over the session on a normal button click and closes back to its trigger without opening or closing the session", () => {
  const root = mount();
  const parent = root.querySelector<HTMLDialogElement>("dialog.session-modal")!;
  parent.setAttribute("open", "");
  // One focusable control per speaker: the portrait opens the same profile by pointer only.
  const speakerControls = [...parent.querySelectorAll<HTMLButtonElement>("[data-agenda-open-speaker]")];
  expect(speakerControls.filter((control) => control.tabIndex >= 0)).toHaveLength(1);
  expect(speakerControls.filter((control) => control.getAttribute("aria-hidden") !== "true")).toHaveLength(1);
  const button = speakerControls.find((control) => control.tabIndex >= 0)!;
  const profile = root.querySelector<HTMLDialogElement>(`#${button.getAttribute("aria-controls")}`)!;
  expect(parent.contains(profile)).toBe(false);
  profile.showModal = vi.fn(() => profile.setAttribute("open", ""));
  profile.close = vi.fn(() => {
    profile.removeAttribute("open");
    profile.dispatchEvent(new Event("close"));
  });
  dispose = initializeAgendaSpeakers(root);
  button.click();
  button.click();
  expect(profile.showModal).toHaveBeenCalledTimes(1);
  expect(parent.open).toBe(true);
  profile.querySelector<HTMLButtonElement>("[data-agenda-close-speaker]")!.click();
  expect(profile.open).toBe(false);
  expect(parent.open).toBe(true);
  expect(document.activeElement).toBe(button);
});
it("keeps no-key credits scoped to their actual occurrence without matching names", () => {
  const source = days();
  const session = source[0]!.slots[0]!.sessions[0]!;
  delete session.speakers[0]!.speakerKey;
  const root = document.createElement("div");
  root.innerHTML = render(
    <AgendaSession
      session={session}
      slot={source[0]!.slots[0]}
      locations={source[0]!.locations}
      dialogId="scoped-session"
      timeZone="UTC"
    />,
  );
  expect(root.querySelector(".pk-agenda-speaker-profile__sessions")?.textContent).toContain("First occurrence");
  expect(root.querySelector(".pk-agenda-speaker-profile__sessions")?.textContent).not.toContain("Repeated occurrence");
});
