// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { expect, it } from "vitest";
import { AgendaSession } from "../../assets/ts/site/AgendaSession";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { agendaContent } from "../../assets/shared/public-agenda-content";
import { publishedSessionRoute } from "../../assets/shared/session-public-route";
import { agendaOccurrenceSchema } from "../../assets/shared/schemas/event-agenda";
import { sessionHistoryMetadataSchema } from "../../assets/shared/schemas/event-session-history";
import { eventParticipationLink } from "../../assets/shared/event-participation-link";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";

function fixture(title = "Networking", kind: "break" | "session" = "break") {
  const snapshot = structuredClone(approvedAgendaSnapshot);
  const original = snapshot.occurrences[0]!;
  snapshot.occurrences = [
    agendaOccurrenceSchema.parse({
      ...original,
      title,
      kind,
      description: "",
      speakers: [],
      startAt: null,
      endAt: null,
      history: sessionHistoryMetadataSchema.parse({
        archivalTiming: {
          sourcePath: "content/events/historical/_index.md",
          sourceDigest: "a".repeat(64),
          provenance: "authored_public",
          timeZone: snapshot.timeZone,
          authoredDate: "2026-12-01",
          authoredStart: "10:00",
          startAt: original.startAt,
          endAt: null,
        },
      }),
    }),
  ];
  return snapshot;
}
function hostFor(snapshot: ReturnType<typeof fixture>) {
  const value = agendaContent(snapshot);
  const host = document.createElement("div");
  host.innerHTML = render(<ContentAgenda {...value} timeZone={snapshot.timeZone} />);
  return { host, value };
}

it.each([
  ["Networking", "break"],
  ["TBA", "session"],
] as const)("keeps actionless %s visible with honest timing but no empty public detail trigger", (title, kind) => {
  const snapshot = fixture(title, kind);
  expect(publishedSessionRoute(snapshot.eventSlug, snapshot.occurrences[0]!)).toBeUndefined();
  const { host } = hostFor(snapshot);
  const card = host.querySelector("article[data-agenda-occurrence]")!;
  expect(card.querySelector("h3")!.textContent).toBe(title);
  expect(card.textContent).toContain("End not recorded");
  expect(card.hasAttribute("data-agenda-session-dialog")).toBe(false);
  expect(card.querySelector("[data-agenda-open-session], dialog")).toBeNull();
});

it("retains a real legacy fragment target as a summary without adding a new empty card trigger", () => {
  const snapshot = fixture();
  snapshot.occurrences[0]!.history = sessionHistoryMetadataSchema.parse({
    ...snapshot.occurrences[0]!.history,
    legacyFragments: [
      {
        anchor: "sessionModal-1000-0-networking",
        kind: "dialog",
        roomRef: "hall",
        roomId: null,
        sourcePath: "content/events/historical/_index.md",
        sourceDigest: "a".repeat(64),
        sourceLocator: "legacy:networking",
        authoredDate: "2026-12-01",
        authoredStart: "10:00",
        authoredTitle: "Networking",
      },
    ],
  });
  const { host } = hostFor(snapshot);
  const alias = host.querySelector<HTMLElement>('[id="sessionModal-1000-0-networking"]')!;
  expect(alias).not.toBeNull();
  const dialog = host.querySelector<HTMLDialogElement>(`dialog[id="${alias.dataset.agendaFragmentDialog}"]`)!;
  expect(dialog).not.toBeNull();
  expect(dialog.classList.contains("session-modal--summary")).toBe(true);
  expect(dialog.querySelector(".session-modal__body")).toBeNull();
  expect(dialog.textContent).toContain("Networking");
  expect(dialog.textContent).toContain("End not recorded");
  expect(host.querySelector("[data-agenda-open-session], [data-agenda-session-dialog]")).toBeNull();
});

it("retains editor detail and management controls for a thin unscheduled card", () => {
  const { value } = hostFor(fixture());
  const day = value.days[0]!;
  const host = document.createElement("div");
  host.innerHTML = render(
    <AgendaSession
      session={day.slots[0]!.sessions[0]!}
      slot={day.slots[0]}
      locations={day.locations}
      dialogId="managed-networking"
      timeZone="Europe/Amsterdam"
      editor={{ controls: <button type="button">Edit session</button> }}
    />,
  );
  expect(host.querySelector('[data-agenda-open-session="managed-networking"]')).not.toBeNull();
  expect(host.querySelector('[data-agenda-session-dialog="managed-networking"]')).not.toBeNull();
  expect(host.querySelector('dialog[id="managed-networking"]')).not.toBeNull();
  expect(host.querySelector(".session-modal--summary")).toBeNull();
  expect(host.textContent).toContain("Edit session");
});

it.each(["registration", "invitation", "online", "description", "speaker", "slides"] as const)(
  "keeps %s details actionable even without a standalone substantive-session route",
  (content) => {
    const { value } = hostFor(fixture("TBA", "session"));
    const day = value.days[0]!;
    const session = day.slots[0]!.sessions[0]!;
    if (content === "registration" || content === "invitation")
      session.participation = eventParticipationLink(
        "approved-event",
        "session",
        "optional_reservation",
        content === "invitation" ? "invitation" : "open",
      );
    if (content === "online") session.onlineAccessUrl = "/portal/#/events/approved-event/agenda?session=session";
    if (content === "description") session.descriptionMarkdown = "Authored short description.";
    if (content === "speaker") session.speakers = [{ name: "Authored speaker", bioMarkdown: "Authored biography." }];
    if (content === "slides") session.presentationUrl = "/approved-slides.pdf";
    const host = document.createElement("div");
    host.innerHTML = render(
      <AgendaSession
        session={session}
        slot={day.slots[0]}
        locations={day.locations}
        dialogId="actionable-session"
        timeZone="Europe/Amsterdam"
      />,
    );
    expect(host.querySelector('[data-agenda-open-session="actionable-session"]')).not.toBeNull();
    expect(host.querySelector('[data-agenda-session-dialog="actionable-session"]')).not.toBeNull();
    expect(host.querySelector('dialog[id="actionable-session"]')).not.toBeNull();
    if (content === "registration") expect(host.textContent).toContain("Register if you wish");
    if (content === "invitation") expect(host.textContent).toContain("Invitation required");
    if (content === "online")
      expect(host.querySelector('a[aria-label="Join online"]')!.getAttribute("href")).toBe(session.onlineAccessUrl);
    if (content === "description")
      expect(host.querySelector("dialog")!.textContent).toContain("Authored short description.");
    if (content === "speaker") expect(host.querySelector("dialog")!.textContent).toContain("Authored biography.");
    if (content === "slides")
      expect(host.querySelector("dialog a[download]")!.getAttribute("href")).toBe("/approved-slides.pdf");
  },
);
