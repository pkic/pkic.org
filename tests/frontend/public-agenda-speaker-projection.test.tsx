import { affiliationLabel } from "../../assets/shared/agenda-speaker-affiliations";
// @vitest-environment jsdom
import { renderToStringAsync } from "preact-render-to-string";
import { expect, it } from "vitest";
import { AgendaSpeaker } from "../../assets/ts/site/AgendaSpeaker";
import { agendaContent, agendaSessionContent, agendaSpeakerContent } from "../../assets/shared/public-agenda-content";
import { publicSessionCredits, sessionDisplayCredits } from "../../assets/shared/session-public-credits";
import { publishedSpeakerProfileRoute } from "../../assets/shared/public-agenda-pages";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";

it("shares frozen portraits, attribution and person links with static session history", async () => {
  const snapshot = structuredClone(approvedAgendaSnapshot);
  const occurrence = snapshot.occurrences[0]!;
  occurrence.speakers[0] = {
    ...occurrence.speakers[0]!,
    displayName: "Later current profile name",
    profileCandidate: {
      identityId: null,
      organizationName: null,
      jobTitle: null,
      biography: "Later current biography",
      links: [],
      photoUrl: "/unapproved-photo.jpg",
    },
  };
  occurrence.history!.archivalCredits.push({
    sourceRef: "authored-speaker",
    sourcePath: "synthetic-public-agenda.yaml",
    sourceDigest: "a".repeat(64),
    provenance: "authored_public",
    role: "panelist",
    displayName: "Retained source speaker",
    jobTitle: "Recorded researcher",
    organizationName: "Recorded employer",
    biography: "Source-authored biography.",
    photoUrl: null,
  });
  const credits = publicSessionCredits(occurrence);
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(
    <div class="pk-content-agenda__speakers">
      {credits.map((credit, index) => (
        <article key={index}>
          <AgendaSpeaker
            speaker={agendaSpeakerContent(occurrence, credit)}
            personPath={publishedSpeakerProfileRoute(snapshot, occurrence, credit)}
            detail
          />
        </article>
      ))}
    </div>,
  );
  const [approved, source] = host.querySelectorAll("article");
  expect(approved.querySelector("h3 a")?.textContent).toBe("Historical speaker");
  expect(approved.querySelector("h3 a")?.getAttribute("href")).toBe("/people/historical-speaker/");
  expect(approved.querySelector("img")?.getAttribute("src")).toBe("/approved-photo.jpg");
  expect(approved.textContent).toContain("Engineer · Historical organization");
  expect(approved.textContent).toContain("Moderator");
  expect(approved.querySelector("details, summary")).toBeNull();
  expect(approved.querySelector(".pk-content-agenda__speaker-bio strong")?.textContent).toBe("Approved biography");
  expect(source.querySelector("h3")?.textContent).toBe("Retained source speaker");
  expect(source.querySelector("h3 a")).toBeNull();
  expect(source.querySelector("img")).toBeNull();
  expect(source.querySelector(".pk-avatar__initials")).not.toBeNull();
  expect(source.textContent).toContain("Panelist");
  expect(source.textContent).toContain("Recorded researcher · Recorded employer");
  expect(source.textContent).toContain("Source-authored biography.");
  expect(host.textContent).not.toContain("Later current");
  expect(host.querySelector('[src="/unapproved-photo.jpg"]')).toBeNull();
  expect(host.querySelector("script")).toBeNull();
  expect(occurrence.history!.appearances).toEqual(approvedAgendaSnapshot.occurrences[0]!.history!.appearances);
});

it("associates same-name canonical users by identity while retaining each frozen appearance", () => {
  const snapshot = structuredClone(approvedAgendaSnapshot);
  const first = snapshot.occurrences[0]!;
  first.history!.appearances[0]!.displayName = "Same speaker name";
  const second = structuredClone(first);
  second.id = "other-session";
  second.speakers[0]!.userId = "other/person";
  second.history!.appearances[0]!.userId = "other/person";
  second.history!.appearances[0]!.affiliations = [
    {
      identityId: null,
      title: "Recorded architect",
      organizationId: null,
      organizationName: "Second recorded organization",
    },
  ];
  snapshot.occurrences.push(second);
  snapshot.speakerProfileSlugs = { ...snapshot.speakerProfileSlugs, "other/person": "same-speaker-name-2" };
  const content = agendaContent(snapshot);
  const sessions = content.days.flatMap((day) => day.slots.flatMap((slot) => slot.sessions));
  expect(content.speakers).toHaveLength(2);
  expect(content.speakers.map((speaker) => speaker.name)).toEqual(["Same speaker name", "Same speaker name"]);
  expect(sessions.map((session) => session.speakers[0]!.speakerKey)).toEqual(["user:person", "user:other/person"]);
  expect(content.speakers.map((speaker) => speaker.speakerKey)).toEqual(
    sessions.map((session) => session.speakers[0]!.speakerKey),
  );
  expect(sessions[0]!.speakers[0]!.affiliations?.map(affiliationLabel)).toEqual(["Engineer · Historical organization"]);
  expect(sessions[1]!.speakers[0]!.affiliations?.map(affiliationLabel)).toEqual([
    "Recorded architect · Second recorded organization",
  ]);
  expect(content.speakers.map((speaker) => speaker.personPath)).toEqual([
    "/people/historical-speaker/",
    "/people/same-speaker-name-2/",
  ]);
  expect(agendaSessionContent(snapshot, second).speakers[0]!.speakerKey).toBe(content.speakers[1]!.speakerKey);
  expect(agendaContent(snapshot, true).speakers.every((speaker) => speaker.personPath === undefined)).toBe(true);
  snapshot.publishedRevision = null;
  expect(agendaContent(snapshot).speakers.every((speaker) => speaker.personPath === undefined)).toBe(true);
});

it("keeps full authored identities distinct and repeated tuples shared without exposing provenance in keys", () => {
  const snapshot = structuredClone(approvedAgendaSnapshot);
  const first = snapshot.occurrences[0]!;
  first.speakers = [];
  first.history!.appearances = [];
  first.history!.archivalCredits = [
    {
      sourceRef: "private authored locator",
      sourcePath: "private/source-one.yaml",
      sourceDigest: "a".repeat(64),
      provenance: "authored_public",
      role: "speaker",
      displayName: "Same authored name",
      jobTitle: null,
      organizationName: null,
      biography: "Recorded source biography.",
      photoUrl: null,
    },
  ];
  const second = structuredClone(first);
  second.id = "different-source";
  second.history!.archivalCredits[0]!.sourcePath = "private/source-two.yaml";
  const third = structuredClone(first);
  third.id = "repeated-source";
  const fourth = structuredClone(first);
  fourth.id = "different-digest";
  fourth.history!.archivalCredits[0]!.sourceDigest = "b".repeat(64);
  const fifth = structuredClone(first);
  fifth.id = "different-locator";
  fifth.history!.archivalCredits[0]!.sourceRef = "another private locator";
  snapshot.occurrences.push(second, third, fourth, fifth);
  const content = agendaContent(snapshot);
  const sessions = content.days.flatMap((day) => day.slots.flatMap((slot) => slot.sessions));
  const keys = sessions.map((session) => session.speakers[0]!.speakerKey);
  expect(keys).toEqual(["source:1", "source:2", "source:1", "source:3", "source:4"]);
  expect(content.speakers).toHaveLength(4);
  expect(content.speakers.map((speaker) => speaker.speakerKey)).toEqual([
    "source:1",
    "source:2",
    "source:3",
    "source:4",
  ]);
  expect(content.speakers.every((speaker) => speaker.name === "Same authored name" && !speaker.personPath)).toBe(true);
  expect(agendaSessionContent(snapshot, third).speakers[0]!.speakerKey).toBe(keys[0]);
  expect(first.history!.archivalCredits[0]!.sourceRef).toBe("private authored locator");
});

it("does not manufacture person links when the approved agenda has no public session history page", () => {
  const snapshot = structuredClone(approvedAgendaSnapshot);
  snapshot.occurrences[0]!.description = "Brief";
  expect(agendaContent(snapshot).speakers[0]!.personPath).toBeUndefined();
  expect(agendaContent(snapshot).speakers[0]!.speakerKey).toBe("user:person");
});

it("preserves roster order and excludes approved credits removed from the roster", () => {
  const occurrence = structuredClone(approvedAgendaSnapshot.occurrences[0]!);
  const first = occurrence.speakers[0]!;
  const appearance = occurrence.history!.appearances[0]!;
  occurrence.speakers = [
    { ...first, userId: "first" },
    { ...first, userId: "second" },
  ];
  occurrence.history!.appearances = [
    { ...appearance, userId: "second", displayName: "Second speaker" },
    { ...appearance, userId: "removed", displayName: "Removed speaker" },
    { ...appearance, userId: "first", displayName: "First speaker" },
  ];
  occurrence.history!.archivalCredits = [];
  expect(publicSessionCredits(occurrence).map((credit) => credit.displayName)).toEqual([
    "First speaker",
    "Second speaker",
  ]);
});

it("reads draft speaker details from the canonical identity rather than historical text", () => {
  const occurrence = structuredClone(approvedAgendaSnapshot.occurrences[0]!);
  const speaker = occurrence.speakers[0]!;
  speaker.displayName = "Canonical speaker";
  speaker.profileCandidate = {
    identityId: "selected-identity",
    organizationName: "Current employer",
    jobTitle: "Current role",
    biography: "Current biography",
    links: ["https://example.org/current"],
    photoUrl: "/current-photo.jpg",
  };
  const draft = sessionDisplayCredits(occurrence, true)[0]!;
  expect(draft.displayName).toBe("Canonical speaker");
  expect(draft).toMatchObject({
    biography: "Current biography",
    links: ["https://example.org/current"],
    photoUrl: "/current-photo.jpg",
    affiliations: [{ identityId: "selected-identity", organizationName: "Current employer", title: "Current role" }],
  });
  expect(occurrence.history!.appearances[0]!.displayName).toBe("Historical speaker");
});

it("omits organization logos on compact session credits and retains them in session details", async () => {
  const speaker = {
    name: "Example speaker",
    affiliations: [
      { title: "Researcher", organization: { name: "Example Institute", logoSrc: "/example-institute.svg" } },
    ],
  };
  const compact = document.createElement("div");
  compact.innerHTML = await renderToStringAsync(<AgendaSpeaker speaker={speaker} />);
  expect(compact.querySelector(".pk-agenda-speaker-organization")).toBeNull();
  expect(compact.textContent).toContain("Researcher · Example Institute");
  const detail = document.createElement("div");
  detail.innerHTML = await renderToStringAsync(<AgendaSpeaker speaker={speaker} detail />);
  expect(detail.querySelector(".pk-agenda-speaker-organization img")?.getAttribute("src")).toBe(
    "/example-institute.svg",
  );
});
