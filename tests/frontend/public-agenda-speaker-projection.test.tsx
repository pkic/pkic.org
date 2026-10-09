// @vitest-environment jsdom
import { renderToStringAsync } from "preact-render-to-string";
import { expect, it } from "vitest";
import { AgendaSpeaker } from "../../assets/ts/site/AgendaSpeaker";
import { agendaContent, agendaSessionContent, agendaSpeakerContent } from "../../assets/shared/public-agenda-content";
import { publicSessionCredits } from "../../assets/shared/session-public-credits";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";

it("shares frozen portraits, attribution and person links with static session history", async () => {
  const snapshot = structuredClone(approvedAgendaSnapshot);
  const occurrence = snapshot.occurrences[0]!;
  occurrence.speakers[0] = {
    ...occurrence.speakers[0]!,
    displayName: "Later current profile name",
    profileCandidate: { biography: "Later current biography", photoUrl: "/unapproved-photo.jpg" },
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
            personPath={"userId" in credit ? `/people/${encodeURIComponent(credit.userId)}/` : undefined}
            detail
          />
        </article>
      ))}
    </div>,
  );
  const [approved, source] = host.querySelectorAll("article");
  expect(approved.querySelector("h3 a")?.textContent).toBe("Historical speaker");
  expect(approved.querySelector("h3 a")?.getAttribute("href")).toBe("/people/person/");
  expect(approved.querySelector("img")?.getAttribute("src")).toBe("/approved-photo.jpg");
  expect(approved.textContent).toContain("Engineer at Historical organization");
  expect(approved.textContent).toContain("Moderator");
  expect(approved.querySelector("details, summary")).toBeNull();
  expect(approved.querySelector(".pk-content-agenda__speaker-bio strong")?.textContent).toBe("Approved biography");
  expect(source.querySelector("h3")?.textContent).toBe("Retained source speaker");
  expect(source.querySelector("h3 a")).toBeNull();
  expect(source.querySelector("img")).toBeNull();
  expect(source.querySelector(".pk-avatar__initials")).not.toBeNull();
  expect(source.textContent).toContain("Panelist");
  expect(source.textContent).toContain("Recorded researcher at Recorded employer");
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
  second.history!.appearances[0]!.jobTitle = "Recorded architect";
  second.history!.appearances[0]!.organizationName = "Second recorded organization";
  snapshot.occurrences.push(second);
  const content = agendaContent(snapshot);
  const sessions = content.days.flatMap((day) => day.slots.flatMap((slot) => slot.sessions));
  expect(content.speakers).toHaveLength(2);
  expect(content.speakers.map((speaker) => speaker.name)).toEqual(["Same speaker name", "Same speaker name"]);
  expect(sessions.map((session) => session.speakers[0]!.speakerKey)).toEqual(["user:person", "user:other/person"]);
  expect(content.speakers.map((speaker) => speaker.speakerKey)).toEqual(
    sessions.map((session) => session.speakers[0]!.speakerKey),
  );
  expect(sessions[0]!.speakers[0]!.title).toBe("Engineer at Historical organization");
  expect(sessions[1]!.speakers[0]!.title).toBe("Recorded architect at Second recorded organization");
  expect(content.speakers.map((speaker) => speaker.personPath)).toEqual(["/people/person/", "/people/other%2Fperson/"]);
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
