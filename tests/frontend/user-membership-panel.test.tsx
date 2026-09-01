// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMembershipPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserMembershipPanel";
import { UserMembershipCard } from "../../assets/ts/member-flows/portal/sections/system-users/UserMembershipCard";
import type { UserDetail, UserMembership } from "../../assets/ts/member-flows/portal/sections/system-users/model";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { identityCreateSchema, identityUpdateSchema } from "../../assets/shared/schemas/identity";
import { memberCapacityUpdateSchema } from "../../assets/shared/schemas/membership-management";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { buttonNamed, chooseOption, controlFor, typeInto } from "./helpers/labelled-control";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000002";
const IDENTITY_ID = "00000000-0000-4000-8000-000000000003";
const MEMBER_ID = "00000000-0000-4000-8000-000000000004";
const GROUP_ID = "00000000-0000-4000-8000-000000000005";
const PICKED_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000006";

const mounted: HTMLElement[] = [];

function membership(overrides: Partial<UserMembership> = {}): UserMembership {
  return {
    identityId: IDENTITY_ID,
    memberId: MEMBER_ID,
    membershipCategory: "A",
    status: "active",
    showOnOrgProfile: true,
    organizationId: ORGANIZATION_ID,
    organizationName: "Organization A",
    emailId: null,
    email: "role@organization-a.example",
    jobTitle: null,
    biography: null,
    links: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    groups: [
      {
        id: GROUP_ID,
        slug: "pqc",
        name: "PQC Working Group",
        type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
      },
    ],
    ...overrides,
  };
}

function userWith(identities: UserMembership[]): UserDetail {
  return {
    id: USER_ID,
    email: "member@example.test",
    first_name: "Test",
    last_name: "User",
    preferred_name: null,
    role: "user",
    active: true,
    isEcMember: false,
    headshotUrl: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    pii_redacted_at: null,
    identities,
  };
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  return container;
}

/**
 * The portal's toast target. `toast()` drops its message when the area is
 * absent, so a failure reported only through a toast would assert nothing.
 */
function toastArea(): HTMLElement {
  const area = document.createElement("div");
  area.id = "portal-toast-area";
  document.body.append(area);
  mounted.push(area);
  return area;
}

function describedByText(control: HTMLElement): string {
  const id = control.getAttribute("aria-describedby");
  if (!id) throw new Error("control carries no aria-describedby");
  return document.querySelector(`[id="${id}"]`)?.textContent ?? "";
}

/** Lets a started request and the re-render it causes settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Presses a button and waits for whatever it started. */
async function press(root: ParentNode, label: string): Promise<void> {
  await act(() => buttonNamed(root, label).click());
  await settle();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The Worker's error envelope, so `ApiClientError` carries the real reason. */
function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { code: "CONFLICT", message } }, status);
}

interface CapturedRequest {
  method: string;
  pathname: string;
  body: unknown;
}

/** Records every request and answers each through `respond`. */
function stubFetch(respond: (url: URL) => Response): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "https://app.test",
      );
      requests.push({
        method: init?.method ?? "GET",
        pathname: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Promise.resolve(respond(url));
    }),
  );
  return requests;
}

function identityMutation(state: "active" | "ended"): Response {
  return jsonResponse({ success: true, identityId: IDENTITY_ID, state });
}

const organizationList = organizationsListResponseSchema.parse({
  organizations: [
    {
      id: PICKED_ORGANIZATION_ID,
      name: "Organization One",
      membershipCategory: "A",
      memberSince: "2026-01-01",
      activeIdentityCount: 1,
      primaryContactName: null,
      primaryContactEmail: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      website: null,
      description: null,
      slogan: null,
      logoUrl: null,
    },
  ],
  page: { limit: 10, offset: 0, total: 1, hasMore: false },
});

const organizationDetail = organizationDetailResponseSchema.parse({
  organization: {
    ...organizationList.organizations[0],
    contentMarkdown: null,
    blogUrl: null,
    blogFeedUrl: null,
    pressUrl: null,
    pressFeedUrl: null,
    careersUrl: null,
    links: [],
    primaryContactUserId: null,
    secondaryContactUserId: null,
    identities: [],
  },
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UserMembershipCard", () => {
  it("renders each organization capacity with only its own groups", () => {
    const user = userWith([
      membership(),
      membership({
        identityId: "00000000-0000-4000-8000-0000000000b3",
        memberId: "00000000-0000-4000-8000-0000000000b4",
        organizationId: "00000000-0000-4000-8000-0000000000b2",
        organizationName: "Organization B",
        membershipCategory: "B",
        groups: [
          {
            id: "00000000-0000-4000-8000-0000000000b5",
            slug: "cm",
            name: "Cryptographic Module Working Group",
            type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
          },
        ],
      }),
    ]);
    const container = mount();

    void act(() => render(<UserMembershipPanel user={user} onChanged={vi.fn()} canManage canActivate />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("PQC Working Group");
    expect(container.textContent).toContain("Organization B");
    expect(container.textContent).toContain("Cryptographic Module Working Group");
    expect(container.textContent).toContain("Add identity");
    // An organization-tied capacity takes its category and status from the
    // organization, so neither is editable here.
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it("names the visibility checkbox and every value it lists", () => {
    const container = mount();
    void act(() =>
      render(<UserMembershipCard membership={membership()} onChanged={async () => {}} canManage />, container),
    );

    // All three parts of the choice control, so it is not an operating-system
    // default box with no accessible name.
    const checkbox = container.querySelector("label.pk-check");
    expect(checkbox?.querySelector("input.pk-check__input")).not.toBeNull();
    expect(checkbox?.querySelector(".pk-check__label")?.textContent).toContain("Organization A");

    // The facts read as a term/value list, so each value is announced with the
    // term that names it rather than sitting in an unnamed table.
    const terms = [...container.querySelectorAll("dl.pk-datalist > dt")].map((term) => term.textContent);
    expect(terms).toEqual([
      "Organization",
      "Identity email",
      "Job title",
      "Category",
      "Status",
      "Groups",
      "Member since",
    ]);
  });

  it("updates a capacity through the canonical capacity route", async () => {
    const requests = stubFetch(() =>
      jsonResponse({
        member: {
          id: MEMBER_ID,
          userId: USER_ID,
          organizationId: null,
          membershipCategory: "H6",
          status: "active",
          showOnOrgProfile: false,
        },
      }),
    );
    const individual = membership({
      membershipCategory: "H5",
      organizationId: null,
      organizationName: null,
      showOnOrgProfile: false,
    });
    const container = mount();
    void act(() =>
      render(<UserMembershipCard membership={individual} onChanged={async () => {}} canManage />, container),
    );

    await chooseOption(controlFor<HTMLSelectElement>(container, "Category"), "H6");
    await settle();

    expect(requests[0]?.pathname).toBe(`/api/v1/members/capacities/${MEMBER_ID}`);
    expect(memberCapacityUpdateSchema.parse(requests[0]?.body)).toEqual({ membershipCategory: "H6" });
  });

  it("renders and edits organization-specific profile fields through the identity route", async () => {
    const requests = stubFetch(() => identityMutation("active"));
    const org = membership({
      jobTitle: "Standards lead",
      biography: "Represents Organization A.",
      links: ["https://organization-a.example/profile"],
    });
    const container = mount();
    void act(() => render(<UserMembershipCard membership={org} onChanged={async () => {}} canManage />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("role@organization-a.example");
    expect(container.textContent).toContain("Standards lead");
    expect(container.textContent).toContain("Represents Organization A.");

    void act(() => buttonNamed(container, "Edit identity profile").click());
    await typeInto(controlFor(container, "Job title for Organization A"), "Updated standards lead");
    await press(container, "Save identity profile");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe(`/api/v1/organizations/${ORGANIZATION_ID}/identities/${IDENTITY_ID}`);
    expect(identityUpdateSchema.parse(requests[0]?.body)).toEqual({
      profile: {
        jobTitle: "Updated standards lead",
        biography: "Represents Organization A.",
        links: ["https://organization-a.example/profile"],
      },
    });
    // The editor closed only because the save succeeded.
    expect(container.textContent).toContain("Edit identity profile");
  });

  it("keeps the identity editor open and reports the reason when the save fails", async () => {
    const area = toastArea();
    stubFetch(() => errorResponse("Job title is too long", 400));
    const container = mount();
    void act(() =>
      render(<UserMembershipCard membership={membership()} onChanged={async () => {}} canManage />, container),
    );

    void act(() => buttonNamed(container, "Edit identity profile").click());
    await press(container, "Save identity profile");

    expect(area.textContent).toContain("Job title is too long");
    // Still editing: a failure must not throw away the unsaved values.
    expect(container.textContent).toContain("Close identity editor");
    expect(container.textContent).toContain("Save identity profile");
  });

  it("only removes a membership through the confirm dialog when the removal is confirmed", async () => {
    const requests = stubFetch(() => identityMutation("ended"));
    const container = mount();
    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserMembershipCard membership={membership()} onChanged={async () => {}} canManage />
        </>,
        container,
      ),
    );

    void act(() => buttonNamed(container, "End identity").click());
    expect(container.textContent).toContain("End the identity for Organization A?");
    void act(() => buttonNamed(container, "Cancel").click());
    await settle();
    expect(requests).toHaveLength(0);

    void act(() => buttonNamed(container, "End identity").click());
    await press(container, "End identity");
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      pathname: `/api/v1/organizations/${ORGANIZATION_ID}/identities/${IDENTITY_ID}`,
    });
    expect(identityUpdateSchema.parse(requests[0]?.body)).toEqual({
      transition: { state: "ended", reason: "Ended from System Users" },
    });
  });
});

describe("UserMembershipPanel", () => {
  it("exposes the empty membership list as a live status region", () => {
    const container = mount();
    void act(() =>
      render(<UserMembershipPanel user={userWith([])} onChanged={vi.fn()} canManage canActivate />, container),
    );

    expect(container.querySelector('[role="status"]')?.textContent).toContain("No active identities.");
  });

  function openGrantForm(): HTMLElement {
    const container = mount();
    void act(() =>
      render(<UserMembershipPanel user={userWith([])} onChanged={async () => {}} canManage canActivate />, container),
    );
    void act(() => buttonNamed(container, "Add identity").click());
    return container;
  }

  async function pickOrganizationOne(container: HTMLElement): Promise<HTMLSelectElement> {
    await press(container, "Search");
    const organization = controlFor<HTMLSelectElement>(container, "Organization");
    await chooseOption(organization, PICKED_ORGANIZATION_ID);
    await settle();
    return organization;
  }

  it("marks the organization field invalid and points the control at the message", async () => {
    const requests = stubFetch(() => jsonResponse({ success: true }));
    const container = openGrantForm();

    await press(container, "Grant");

    expect(requests).toHaveLength(0);
    const organization = controlFor<HTMLSelectElement>(container, "Organization");
    expect(organization.getAttribute("aria-invalid")).toBe("true");
    const message = document.querySelector(`[id="${organization.getAttribute("aria-describedby") ?? ""}"]`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("Pick an organization.");
  });

  it("requires a documented reason before activating an identity immediately", async () => {
    const requests = stubFetch((url) =>
      url.pathname === "/api/v1/organizations" ? jsonResponse(organizationList) : jsonResponse(organizationDetail),
    );
    const container = openGrantForm();

    await pickOrganizationOne(container);
    expect(container.textContent).toContain("Category: A");

    const activate = container.querySelector<HTMLInputElement>("input#identity-activate-immediately");
    await act(() => {
      activate!.checked = true;
      activate!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Whitespace clears the browser's own `required` check, so the surface's
    // trim is the only thing standing between this and an undocumented
    // immediate activation.
    const reason = controlFor(container, "Activation reason");
    expect(reason.getAttribute("required")).not.toBeNull();
    await typeInto(reason, "   ");
    await press(container, "Grant");

    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(reason)).toContain("Document why this identity is being activated immediately.");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);

    await typeInto(reason, "Board approved on 2026-08-30");
    await press(container, "Grant");

    const post = requests.find((request) => request.method === "POST");
    expect(post?.pathname).toBe(`/api/v1/organizations/${PICKED_ORGANIZATION_ID}/identities`);
    expect(identityCreateSchema.parse(post?.body)).toMatchObject({
      userReference: "existing_user",
      userId: USER_ID,
      showOnOrganizationProfile: true,
      activation: { mode: "immediate", reason: "Board approved on 2026-08-30" },
    });
  });

  it("reports a rejected grant as a whole-form alert rather than blaming a control", async () => {
    const area = toastArea();
    stubFetch((url) => {
      if (url.pathname === "/api/v1/organizations") return jsonResponse(organizationList);
      if (url.pathname === `/api/v1/organizations/${PICKED_ORGANIZATION_ID}`) return jsonResponse(organizationDetail);
      return errorResponse("This user already holds an identity here", 409);
    });
    const container = openGrantForm();

    const organization = await pickOrganizationOne(container);
    await press(container, "Grant");

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This user already holds an identity here",
    );
    expect(area.textContent).toContain("This user already holds an identity here");
    // The failure is not attributed to a control that is filled in correctly.
    expect(organization.getAttribute("aria-invalid")).toBeNull();
  });
});
