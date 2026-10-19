// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { actingIdentitySchema } from "../../assets/shared/schemas/identity";
import {
  organizationMemberProfileSchema,
  organizationSecondaryContactNominationSchema,
} from "../../assets/shared/schemas/organization-self-service";
import { OrganizationGovernanceCard } from "../../assets/ts/member-flows/portal/sections/MyOrganizationGovernance";
import { controlFor } from "./helpers/labeled-control";

const organizationId = "00000000-0000-4000-8000-000000000210";
const userId = "00000000-0000-4000-8000-000000000211";
const nomineeUserId = "00000000-0000-4000-8000-000000000212";
const at = "2026-10-17T00:00:00.000Z";
function identity(name: string, id: string) {
  return actingIdentitySchema.parse({
    id,
    userId: id,
    userName: name,
    memberId: null,
    organizationId,
    organizationName: "Example",
    membershipCategory: "F",
    emailId: null,
    email: `${name.toLowerCase()}@example.test`,
    jobTitle: "Engineer",
    biography: null,
    links: [],
    headshotUrl: null,
    source: "staff",
    state: "active",
    showOnOrganizationProfile: true,
    invitedAt: at,
    startedAt: at,
    endedAt: null,
    blockedAt: null,
    blockedByUserId: null,
    predecessorIdentityId: null,
    createdAt: at,
    updatedAt: at,
  });
}
function organization(overrides: Record<string, unknown> = {}) {
  return organizationMemberProfileSchema.parse({
    id: organizationId,
    name: "Example",
    isOrgContact: false,
    isPrimaryContact: false,
    isSecondaryContact: false,
    primaryContact: identity("Primary", userId),
    secondaryContact: identity("Secondary", nomineeUserId),
    pendingSecondaryContact: null,
    pendingSecondaryContactUserId: null,
    pendingReview: null,
    website: null,
    description: null,
    slogan: null,
    logoUrl: null,
    contentMarkdown: null,
    blogUrl: null,
    blogFeedUrl: null,
    pressUrl: null,
    pressFeedUrl: null,
    careersUrl: null,
    links: [],
    ...overrides,
  });
}
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});
function show(org = organization(), reload = vi.fn(async () => {})) {
  void act(() =>
    render(<OrganizationGovernanceCard organizationId={organizationId} org={org} reload={reload} />, container),
  );
}

it.each([
  ["Primary contact", true, false],
  ["Secondary contact", false, true],
  ["Representative", false, false],
] as const)("shows confirmed contacts and the viewer role for %s", (role, primary, secondary) => {
  show(organization({ isOrgContact: primary || secondary, isPrimaryContact: primary, isSecondaryContact: secondary }));
  const terms = [...container.querySelectorAll("dt")];
  expect(terms.find((term) => term.textContent === "Your role")?.nextElementSibling?.textContent).toBe(role);
  expect(terms.find((term) => term.textContent === "Primary contact")?.nextElementSibling?.textContent).toContain(
    "Primary",
  );
  expect(terms.find((term) => term.textContent === "Secondary contact")?.nextElementSibling?.textContent).toContain(
    "Secondary",
  );
  expect(container.querySelectorAll("select")).toHaveLength(primary ? 1 : 0);
  expect(container.textContent).not.toContain("None pending");
  expect(container.textContent).not.toContain("Not assigned");
});

it("distinguishes a vacancy from a pending replacement and keeps the confirmed holder visible", () => {
  show(
    organization({
      primaryContact: null,
      pendingSecondaryContactUserId: userId,
      pendingSecondaryContact: identity("Nominee", userId),
    }),
  );
  expect(container.textContent).toContain("Not assigned");
  expect(container.textContent).toContain("Pending staff confirmation: Nominee");
  expect(container.textContent).toContain("current secondary contact remains assigned");
  expect(container.textContent).toContain("Secondary");
  expect(container.querySelector("select")).toBeNull();
});

it("initializes the nomination from pending state and withdraws it without clearing the confirmed holder", async () => {
  const requests: RequestInit[] = [];
  const reload = vi.fn(async () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      requests.push(init);
      return new Response(JSON.stringify({ pendingSecondaryContactUserId: null }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  show(organization({ isOrgContact: true, isPrimaryContact: true, pendingSecondaryContactUserId: userId }), reload);
  const select = controlFor<HTMLSelectElement>(container, "Replacement nominee");
  // A stale nominee is still named by the API; the field does not pretend the confirmed holder is a nomination.
  void act(() => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    [...container.querySelectorAll("button")].find((button) => button.textContent === "Withdraw nomination")!.click();
  });
  expect(requests[0].method).toBe("DELETE");
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(container.textContent).toContain("Secondary");
});

it("validates a nomination through the shared request contract before sending", async () => {
  const reload = vi.fn(async () => {});
  const requests: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      requests.push(organizationSecondaryContactNominationSchema.parse(JSON.parse(init.body)));
      return new Response(JSON.stringify({ pendingSecondaryContactUserId: nomineeUserId }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  show(organization({ isOrgContact: true, isPrimaryContact: true }), reload);
  const select = controlFor<HTMLSelectElement>(container, "Replacement nominee");
  // The membership roster supplies the normal options. A DOM-injected invalid
  // option still cannot bypass the request contract.
  const option = document.createElement("option");
  option.value = "invalid";
  select.append(option);
  void act(() => {
    select.value = "invalid";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(requests).toHaveLength(0);
  option.value = nomineeUserId;
  void act(() => {
    select.value = nomineeUserId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(requests).toEqual([{ userId: nomineeUserId }]);
});

it("refreshes confirmed assignments and permissions when the profile changes", () => {
  show(organization({ isOrgContact: true, isPrimaryContact: true }));
  expect(container.querySelector("select")).not.toBeNull();
  show(organization({ primaryContact: identity("Replacement", userId), secondaryContact: null }));
  expect(container.querySelector("select")).toBeNull();
  expect(container.textContent).toContain("Replacement");
  expect(container.textContent).toContain("Not assigned");
});
