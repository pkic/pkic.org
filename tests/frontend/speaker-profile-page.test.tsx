// @vitest-environment jsdom
import { renderToStringAsync } from "preact-render-to-string";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { ProfileShowcase } from "../../assets/ts/site/ProfileShowcase";
import { AgendaSpeaker } from "../../assets/ts/site/AgendaSpeaker";
import { personProfileStructuredData } from "../../functions/_lib/services/site-history-structured-data";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { publishedSpeakerHistory } from "../../functions/_lib/services/site-session-history";
import {
  appearanceContent,
  publicationProfileLinks,
  publishedPersonProfile,
} from "../../functions/_lib/services/site-person-profile";
import type { PublishedSpeaker } from "../../functions/_lib/services/site-session-history";
import type { SitePublicationSnapshot } from "../../assets/shared/schemas/site-publication";
import { approvedAgendaPublication, approvedAgendaSnapshot } from "../fixtures/approved-agenda";

const memberOrganizationId = approvedAgendaPublication.members[0]!.id;
const LINKEDIN = "https://www.linkedin.com/in/historical-speaker";

/** The latest approved credit, as the agenda's cards and dialogs present it. */
function latestCredit(publication: SitePublicationSnapshot, person: PublishedSpeaker) {
  return appearanceContent(publicationProfileLinks(publication), person.appearances[0]!);
}

/**
 * The same person at an earlier event in two capacities: chair of an organization with a logo
 * and a member page, and an officer of one with neither, whose legacy title repeats its name.
 */
function publicationWithTwoEvents() {
  const earlier = structuredClone(approvedAgendaSnapshot);
  earlier.eventSlug = "earlier-event";
  earlier.eventName = "Earlier conference";
  earlier.speakerOrganizations = {
    [memberOrganizationId]: { name: "PKI Consortium", logoUrl: "/api/v1/members/consortium/logo" },
    digitorus: { name: "Digitorus", logoUrl: "/api/v1/members/digitorus/logo" },
  };
  const occurrence = earlier.occurrences[0]!;
  occurrence.id = "earlier-session";
  occurrence.title = "Earlier panel";
  occurrence.startAt = "2025-12-01T09:00:00.000Z";
  occurrence.endAt = "2025-12-01T10:00:00.000Z";
  occurrence.speakers = [{ userId: "person", displayName: "Historical speaker", role: "panelist" }];
  occurrence.history!.appearances = [
    {
      ...occurrence.history!.appearances[0]!,
      affiliations: [
        {
          identityId: "chair-identity",
          title: "Chair",
          organizationId: memberOrganizationId,
          organizationName: "PKI Consortium",
        },
        { identityId: "company-identity", title: "CEO", organizationId: "digitorus", organizationName: "Digitorus" },
        { identityId: "officer-identity", title: "President, LDIQ", organizationId: null, organizationName: "LDIQ" },
      ],
    },
  ];
  const current = structuredClone(approvedAgendaSnapshot);
  current.eventName = "Current conference";
  current.occurrences[0]!.history!.appearances[0]!.links = [LINKEDIN];
  return sitePublicationSnapshotSchema.parse({
    ...approvedAgendaPublication,
    eventAgendas: { "approved-event": current, "earlier-event": earlier },
  });
}

it("presents one site-wide profile with every event, role and the representation approved at the time", async () => {
  const publication = publicationWithTwoEvents();
  const [person] = publishedSpeakerHistory(publication);
  const profile = publishedPersonProfile(publication, person!);
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(<ProfileShowcase profile={profile} mode="public" />);

  // The header is the most recent approved representation, with portrait, headline and biography.
  expect(host.querySelector("h1")?.textContent).toBe("Historical speaker");
  expect(host.querySelector(".pk-profile-header__lede")?.textContent).toBe("Engineer at Historical organization");
  expect(host.querySelector(".pk-markdown strong")?.textContent).toBe("Approved biography");
  expect(host.querySelector(".pk-profile-header__media img")?.outerHTML).toContain("/approved-photo.jpg");
  expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector(`.pk-profile-header a[href="${LINKEDIN}"]`)).not.toBeNull();

  // Events, most recent first, each heading linking to the event's agenda page.
  const events = [...host.querySelectorAll(".pk-agenda-speaker-profile__sessions")];
  expect(events.map((event) => event.querySelector("h3 a")?.textContent)).toEqual([
    "Current conference",
    "Earlier conference",
  ]);
  expect(events[0]!.querySelector("h3 a")?.getAttribute("href")).toBe("/events/approved-event/agenda/");
  const [current, earlier] = events.map((event) => event.querySelector("li")!);
  expect(current!.querySelector("a")?.getAttribute("href")).toBe("/events/approved-event/sessions/session/");
  expect(current!.querySelector("time")?.getAttribute("datetime")).toBe("2026-12-01T09:00:00.000Z");
  expect(current!.textContent).toContain("Moderator");
  expect(earlier!.querySelector("a")?.getAttribute("href")).toBe("/events/earlier-event/sessions/earlier-session/");
  expect(earlier!.textContent).toContain("Panelist");
  // Every capacity side by side as units of the same structure. A logo names its organization as image
  // text and tooltip, so its unit reads only the title; an organization without a logo has no mark and is
  // written out once in the text.
  const items = [...earlier!.querySelectorAll(".pk-agenda-speaker-affiliations > li")];
  expect(items.map((item) => item.lastElementChild?.textContent)).toEqual(["Chair", "CEO", "President · LDIQ"]);
  expect(items.map((item) => item.querySelectorAll(".pk-agenda-speaker-organization").length)).toEqual([1, 1, 0]);
  const logos = [...earlier!.querySelectorAll(".pk-agenda-speaker-organization")];
  expect(logos.map((logo) => logo.getAttribute("title"))).toEqual(["PKI Consortium", "Digitorus"]);
  // The shared avatar inside is decorative; the mark itself carries the organization's name.
  expect(logos.map((logo) => logo.getAttribute("aria-label"))).toEqual(["PKI Consortium", "Digitorus"]);
  expect(logos.map((logo) => logo.querySelector("img")?.getAttribute("src"))).toEqual([
    "/api/v1/members/consortium/logo",
    "/api/v1/members/digitorus/logo",
  ]);
  expect(items[0]!.querySelector("a")?.getAttribute("href")).toBe("/members/example-corp/");
  expect(earlier!.textContent).not.toContain("Chair · PKI Consortium");

  expect(personProfileStructuredData(publication, person!, profile, "https://pkic.org").mainEntity.sameAs).toEqual([
    LINKEDIN,
  ]);
  // A page, not a dialog: nothing to open or close.
  expect(host.querySelector("dialog, button")).toBeNull();
});

it("names every capacity once in structured data and rotates one unit at a time on cards", async () => {
  const publication = publicationWithTwoEvents();
  const earlier = publication.eventAgendas!["earlier-event"]!;
  const [person] = publishedSpeakerHistory({ ...publication, eventAgendas: { "earlier-event": earlier } });
  const profile = publishedPersonProfile(publication, person!);
  const graph = personProfileStructuredData(publication, person!, profile, "https://pkic.org").mainEntity;
  expect(graph.jobTitle).toEqual(["Chair", "CEO", "President"]);
  expect(graph.affiliation).toEqual([
    { "@type": "Organization", name: "PKI Consortium", url: "https://pkic.org/members/example-corp/" },
    { "@type": "Organization", name: "Digitorus" },
    { "@type": "Organization", name: "LDIQ" },
  ]);
  expect(graph.worksFor).toEqual(graph.affiliation);

  const card = document.createElement("div");
  card.innerHTML = await renderToStringAsync(
    <AgendaSpeaker speaker={latestCredit(publication, person!)} profileId="profile" />,
  );
  // A card has no room for every affiliation: one unit at a time, crossfading through all three.
  const rotation = card.querySelector(".pk-agenda-speaker__open .pk-affiliation-rotation")!;
  expect(rotation.classList).toContain("pk-affiliation-rotation--rotate-3");
  const units = [...rotation.querySelectorAll(".pk-affiliation-rotation__unit")];
  expect(units.map((unit) => unit.querySelector(".pk-agenda-speaker-affiliations__text")?.textContent)).toEqual([
    "Chair",
    "CEO",
    "President · LDIQ",
  ]);
  expect(units.map((unit) => unit.querySelectorAll(".pk-agenda-speaker-organization").length)).toEqual([1, 1, 0]);
  // The units are hidden from assistive technology, which reads every affiliation once and hears no change.
  expect(rotation.querySelector(".pk-affiliation-rotation__units")?.getAttribute("aria-hidden")).toBe("true");
  expect(rotation.querySelector(".pk-sr-only")?.textContent).toBe(
    "Chair · PKI Consortium; CEO · Digitorus; President · LDIQ",
  );
  expect(rotation.querySelector("[aria-live]")).toBeNull();
  // The count is there for the still view with reduced motion.
  expect(rotation.querySelector(".pk-affiliation-rotation__more")?.textContent).toBe("+2");

  // Only the profile has room for the whole list.
  const dialog = card.querySelector("dialog")!;
  expect(dialog.querySelectorAll(".pk-agenda-speaker-affiliations > li")).toHaveLength(3);
  expect(dialog.querySelector(".pk-affiliation-rotation")).toBeNull();
});

it("opens the profile dialog, in the session details' shell, on the speaker's name", async () => {
  const publication = publicationWithTwoEvents();
  const [person] = publishedSpeakerHistory(publication);
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(
    <article class="session-modal__speaker">
      <AgendaSpeaker speaker={latestCredit(publication, person!)} detail profileId="profile" />
    </article>,
  );
  const dialog = host.querySelector("dialog")!;
  // The profile wears the session details' shell.
  expect(dialog.querySelector(":scope > .session-modal__header .session-modal__tools")).not.toBeNull();
  // The name receives focus on open, as the session details title does; the close control does not.
  const heading = dialog.querySelector("h2.session-modal__title")!;
  expect(heading.textContent).toBe(latestCredit(publication, person!).name);
  expect(heading.hasAttribute("autofocus")).toBe(true);
  expect(heading.getAttribute("tabindex")).toBe("-1");
  expect(dialog.querySelector("button[autofocus]")).toBeNull();
  expect(dialog.querySelector(`a[href="${LINKEDIN}"]`)).not.toBeNull();
});

it("keeps the session card's credit avatar rules on the credit's own avatar", () => {
  // Card avatar rules address the credit's own avatar only, never a portrait in a profile it opens.
  const css = readFileSync(resolve("assets/ts/site/AgendaDesign.css"), "utf8");
  for (const selector of css.match(/[^{}]*session-modal__speaker[^{}]*\{/gu) ?? [])
    expect(selector, selector).not.toMatch(/session-modal__speaker \.pk-avatar\b/u);
});

it("marks a panel's moderator quietly beside the name and keeps each card's affiliation row unclipped", async () => {
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(
    <div>
      <AgendaSpeaker
        speaker={{ name: "Moderating speaker", moderator: true, affiliations: [{ title: "Chair" }] }}
        profileId="moderator"
      />
      <AgendaSpeaker
        speaker={{ name: "Panel speaker", roleLabel: "Panelist", affiliations: [{ title: "CEO" }] }}
        profileId="panelist"
      />
    </div>,
  );
  // The role sits in the name's row, which spaces it with the shared gap, never glued to the name.
  for (const [name, role] of [
    ["Moderating speaker", "Moderator"],
    ["Panel speaker", "Panelist"],
  ]) {
    const row = [...host.querySelectorAll(".pk-agenda-speaker__open .pk-content-agenda__speaker-name")].find((item) =>
      item.textContent?.startsWith(name!),
    )!;
    expect(row.querySelector(".pk-badge")?.textContent).toBe(role);
  }
  const css = readFileSync(resolve("assets/ts/site/AgendaSpeaker.css"), "utf8");
  // A small role marker, and marks that never shrink.
  expect(css).toMatch(/\.pk-content-agenda__speaker-name \.pk-badge \{[^}]*font-size: var\(--pk-text-2xs\)/u);
  expect(css).toMatch(/\.pk-agenda-speaker-organization \{[^}]*flex: none/u);
});

it("crossfades every count from two to five without scripts, holds on hover and stays still with reduced motion", async () => {
  // Whitespace-insensitive, so the assertions survive the layer's indentation.
  const css = readFileSync(resolve("assets/ts/site/AgendaAffiliationRotation.css"), "utf8").replace(/\s+/gu, " ");
  for (let count = 2; count <= 5; count += 1) {
    expect(css).toContain(`@keyframes pk-affiliation-rotate-${count} {`);
    expect(css).toContain(
      `.pk-affiliation-rotation--rotate-${count} .pk-affiliation-rotation__unit { animation: pk-affiliation-rotate-${count} calc(var(--pk-dur-affiliation) * ${count})`,
    );
    for (let index = 2; index <= count; index += 1)
      expect(css).toContain(
        `.pk-affiliation-rotation--rotate-${count} .pk-affiliation-rotation__unit:nth-child(${index}) { animation-delay: calc(var(--pk-dur-affiliation) * ${index - 1});`,
      );
  }
  // Every unit shares one cell, so the row never changes height or jumps in width, and long text truncates.
  expect(css).toMatch(/\.pk-affiliation-rotation__unit \{[^}]*grid-area: 1 \/ 1/u);
  expect(css).toMatch(/\.pk-agenda-speaker-affiliations__text \{[^}]*text-overflow: ellipsis/u);
  expect(css).toMatch(
    /:is\(\s*:hover,\s*:focus-within\s*\)\s*\.pk-affiliation-rotation__unit \{\s*animation-play-state: paused/u,
  );
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\) \{[^@]*animation: none[^@]*:not\(:first-child\) \{\s*display: none[^@]*__more \{\s*display: inline/u,
  );

  // A single affiliation is simply shown.
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(
    <AgendaSpeaker speaker={{ name: "Single", affiliations: [{ title: "Chair" }] }} profileId="single" />,
  );
  const single = host.querySelector(".pk-agenda-speaker__open .pk-affiliation-rotation")!;
  expect(single.className).toBe("pk-affiliation-rotation");
  expect(single.querySelectorAll(".pk-affiliation-rotation__unit")).toHaveLength(1);
  expect(single.querySelector(".pk-affiliation-rotation__more")).toBeNull();
});
