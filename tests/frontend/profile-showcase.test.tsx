// @vitest-environment jsdom
/**
 * One profile layout in two modes: the public page shows only what is
 * published, the owner's view also lists what is hidden, marked, with the
 * commands the portal supplies; and the portal page reads the projection and
 * links to the public page once the site renders one.
 */
import { render } from "preact";
import { renderToStringAsync } from "preact-render-to-string";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { personProfileResponseSchema, personProfileSchema } from "../../assets/shared/schemas/person-profile";
import { ProfileShowcase } from "../../assets/ts/site/ProfileShowcase";
import { UserProfileShowcase } from "../../assets/ts/member-flows/portal/sections/system-users/UserProfileShowcase";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { publishedSpeakerHistory } from "../../functions/_lib/services/site-session-history";
import { publishedPersonProfile } from "../../functions/_lib/services/site-person-profile";
import { approvedAgendaPublication, approvedAgendaSnapshot } from "../fixtures/approved-agenda";
import { NEW_TAB_HINT } from "../../assets/ts/ui/new-tab";

const userId = "00000000-0000-4000-8000-000000000041";
const shownId = "00000000-0000-4000-8000-000000000042";
const hiddenId = "00000000-0000-4000-8000-000000000043";

const identity = {
  startedAt: "2024-01-01T00:00:00.000Z",
  endedAt: null,
  biography: "",
  links: [],
};
const profile = personProfileSchema.parse({
  userId,
  name: "Profile person",
  route: "/people/profile-person/",
  imageSrc: null,
  headline: "Chair at Example Trust",
  biographyMarkdown: "Works on certificate lifecycles.",
  links: [],
  identities: [
    {
      ...identity,
      id: shownId,
      title: "Chair",
      organization: { name: "Example Trust", logoSrc: "/example-logo.png", href: "/members/example-trust/" },
      visibility: "public",
    },
    { ...identity, id: hiddenId, title: "Advisor", organization: { name: "Quiet Labs" }, visibility: "hidden" },
  ],
  events: [],
  groups: [
    {
      groupSlug: "pqc",
      groupName: "PQC working group",
      title: "Member",
      leadership: false,
      startsAt: null,
      endsAt: null,
    },
  ],
  candidacies: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("publishes every identity staff did not hide and marks a hidden one for its owner", async () => {
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(<ProfileShowcase profile={profile} mode="public" />);
  expect(host.querySelector("h1")?.textContent).toBe("Profile person");
  expect(host.textContent).toContain("Chair");
  expect(host.textContent).not.toContain("Quiet Labs");
  expect(host.querySelector('a[href="/members/example-trust/"]')).not.toBeNull();
  expect(host.textContent).toContain("PQC working group");
  // Read-only: no commands, and no owner's marks.
  expect(host.querySelector("button, .pk-badge")).toBeNull();

  host.innerHTML = await renderToStringAsync(
    <ProfileShowcase profile={profile} mode="owner" actions={<a href="#/users/edit">Edit profile</a>} />,
  );
  expect(host.querySelector("h1")).toBeNull();
  expect(host.querySelector("h2")?.textContent).toBe("Profile person");
  expect(host.textContent).toContain("Quiet Labs");
  expect([...host.querySelectorAll(".pk-badge")].map((badge) => badge.textContent)).toEqual([
    "Hidden from your public page by an administrator",
  ]);
  expect(host.querySelector('a[href="#/users/edit"]')).not.toBeNull();
});

it("leaves out a session whose speaker has no approved appearance", () => {
  const unapproved = structuredClone(approvedAgendaSnapshot);
  unapproved.occurrences[0]!.history!.appearances = [];
  const publication = sitePublicationSnapshotSchema.parse({
    ...approvedAgendaPublication,
    eventAgendas: { "approved-event": unapproved },
  });
  // A roster credit alone never earns a page.
  expect(publishedSpeakerHistory(publication)).toEqual([]);

  const [person] = publishedSpeakerHistory(approvedAgendaPublication);
  expect(
    publishedPersonProfile(approvedAgendaPublication, person!).events.map((event) => event.eventName),
  ).toHaveLength(1);
});

it("reads the profile in the portal and links to the public page", async () => {
  const fetchMock = vi.fn(async () => Response.json(personProfileResponseSchema.parse({ audience: "owner", profile })));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<UserProfileShowcase userId={userId} canRead />, container);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`/api/v1/users/${userId}/profile`);
  expect(container.querySelector('a[href="/people/profile-person/"]')?.textContent).toBe(
    `View public page ${NEW_TAB_HINT}`,
  );
  expect(container.querySelector(`a[href="#/users/${userId}/edit"]`)?.textContent).toBe("Edit profile");
  expect(container.textContent).toContain("Hidden from your public page by an administrator");
  // Each identity the owner holds opens its own edit view.
  expect(
    [...container.querySelectorAll<HTMLAnchorElement>('a[href*="/profile/"]')].map((link) => link.getAttribute("href")),
  ).toEqual([`#/users/${userId}/profile/${shownId}/edit`, `#/users/${userId}/profile/${hiddenId}/edit`]);
});

it("offers no edit view for an identity that has ended", async () => {
  const ended = personProfileSchema.parse({
    ...profile,
    identities: profile.identities.map((item) => ({ ...item, endedAt: "2025-01-01T00:00:00.000Z" })),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(personProfileResponseSchema.parse({ audience: "owner", profile: ended }))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<UserProfileShowcase userId={userId} canRead />, container);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.textContent).toContain("Quiet Labs");
  expect(container.querySelector('a[href*="/profile/"]')).toBeNull();
});
