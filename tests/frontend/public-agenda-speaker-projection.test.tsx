// @vitest-environment jsdom
import { renderToStringAsync } from "preact-render-to-string";
import { expect, it } from "vitest";
import { AgendaSpeaker } from "../../assets/ts/site/AgendaSpeaker";
import { agendaSpeakerContent } from "../../assets/shared/public-agenda-content";
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
