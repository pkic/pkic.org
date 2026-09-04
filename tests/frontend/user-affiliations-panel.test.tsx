// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserAffiliationsPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationsPanel";
import { UserAffiliationRow } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationRow";
import type { UserDetail, UserMembership } from "../../assets/ts/member-flows/portal/sections/system-users/model";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { identityCreateSchema, identityUpdateSchema } from "../../assets/shared/schemas/identity";
import {
  individualMembershipGrantSchema,
  memberCapacityUpdateSchema,
} from "../../assets/shared/schemas/membership-management";
import { organizationIdentityCreateRequestSchema } from "../../assets/shared/schemas/route-contracts-identities";
import { normalizeValidation } from "../../assets/ts/shared/form/validation-map";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { buttonNamed, chooseOption, controlFor, typeInto } from "./helpers/labelled-control";
import { menuItemNamed } from "./helpers/row-actions";

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
    formerIdentities: [],
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

/** A validation refusal that names its fields, as the Worker sends one. */
function fieldRefusal(fieldErrors: Record<string, string[]>): Response {
  return jsonResponse({ error: { code: "VALIDATION", message: "Invalid request", details: { fieldErrors } } }, 400);
}

function fieldOf(control: HTMLElement): HTMLElement {
  const field = control.closest<HTMLElement>(".pk-field");
  if (!field) throw new Error("control is not inside a Field");
  return field;
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
    formerIdentities: [],
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

/** A menu trigger, which names itself through `aria-label` rather than text. */
function menuTrigger(container: HTMLElement, label: string): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`no menu is named "${label}"`);
  return trigger;
}

/** Opens one affiliation's menu and runs the item reading exactly `label`. */
function runRowMenuAction(container: HTMLElement, organization: string, label: string) {
  void act(() => menuTrigger(container, `Actions for ${organization}`).click());
  const item = menuItemNamed(container, label);
  if (!item) throw new Error(`the row for "${organization}" offers no "${label}"`);
  void act(() => item.click());
}

describe("UserAffiliationRow", () => {
  it("renders every organization capacity with the terms of its own tie", () => {
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

    void act(() => render(<UserAffiliationsPanel user={user} onChanged={vi.fn()} canManage canActivate />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("Organization B");
    // Each tie carries its own address, which is what distinguishes two
    // affiliations held by one person. Their groups are not here: the record
    // states those once, in the participation table.
    expect(container.textContent).toContain("role@organization-a.example");
    expect(container.textContent).not.toContain("PQC Working Group");
    // The panel's own action is in its menu, not a button competing with the
    // ties the panel is about.
    expect(menuTrigger(container, "Affiliation settings")).toBeDefined();
    // An organization-tied capacity takes its category and status from the
    // organization, so neither is editable here.
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("states the terms of the tie and names the change its visibility action makes", () => {
    const container = mount();
    void act(() =>
      render(<UserAffiliationRow membership={membership()} onChanged={async () => {}} canManage />, container),
    );

    // The terms of the tie read as a list rather than a run-on sentence, so
    // the separators between them stay presentational and are never announced.
    // The groups are not among them: the record states those once, in the
    // participation table, with the seat and the attendance beside them.
    const terms = [...container.querySelectorAll("ul.pk-affiliation__terms > li")].map((term) => term.textContent);
    expect(terms).toEqual(["since Aug 1, 2026", "role@organization-a.example"]);
    expect(container.textContent).not.toContain("PQC Working Group");

    // The visibility control is a menu item now, so it names the change it
    // will make; the marker beside the name is what states where things stand.
    void act(() => menuTrigger(container, "Actions for Organization A").click());
    expect(menuItemNamed(container, "Hide from Organization A's public profile")).not.toBeNull();
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
      render(<UserAffiliationRow membership={individual} onChanged={async () => {}} canManage />, container),
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
    void act(() => render(<UserAffiliationRow membership={org} onChanged={async () => {}} canManage />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("role@organization-a.example");
    expect(container.textContent).toContain("Standards lead");
    expect(container.textContent).toContain("Represents Organization A.");

    runRowMenuAction(container, "Organization A", "Edit identity profile…");
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
    // The editor closed only because the save succeeded: its Save control is
    // gone, and the menu offers to open it again.
    expect(container.textContent).not.toContain("Save identity profile");
  });

  it("keeps the identity editor open and reports the reason when the save fails", async () => {
    const area = toastArea();
    stubFetch(() => errorResponse("Job title is too long", 400));
    const container = mount();
    void act(() =>
      render(<UserAffiliationRow membership={membership()} onChanged={async () => {}} canManage />, container),
    );

    runRowMenuAction(container, "Organization A", "Edit identity profile…");
    await press(container, "Save identity profile");

    expect(area.textContent).toContain("Job title is too long");
    // Still editing: a failure must not throw away the unsaved values.
    expect(container.textContent).toContain("Save identity profile");
  });

  it("only removes a membership through the confirm dialog when the removal is confirmed", async () => {
    const requests = stubFetch(() => identityMutation("ended"));
    const container = mount();
    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserAffiliationRow membership={membership()} onChanged={async () => {}} canManage />
        </>,
        container,
      ),
    );

    runRowMenuAction(container, "Organization A", "End identity…");
    expect(container.textContent).toContain("End the identity for Organization A?");
    void act(() => buttonNamed(container, "Cancel").click());
    await settle();
    expect(requests).toHaveLength(0);

    runRowMenuAction(container, "Organization A", "End identity…");
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

describe("UserAffiliationsPanel", () => {
  it("exposes the empty membership list as a live status region", () => {
    const container = mount();
    void act(() =>
      render(<UserAffiliationsPanel user={userWith([])} onChanged={vi.fn()} canManage canActivate />, container),
    );

    expect(container.querySelector('[role="status"]')?.textContent).toContain("No active identities.");
  });

  function openGrantForm(): HTMLElement {
    const container = mount();
    void act(() =>
      render(<UserAffiliationsPanel user={userWith([])} onChanged={async () => {}} canManage canActivate />, container),
    );
    void act(() => menuTrigger(container, "Affiliation settings").click());
    const add = menuItemNamed(container, "Add identity…");
    if (!add) throw new Error('the panel offers no "Add identity…"');
    void act(() => add.click());
    return container;
  }

  async function pickOrganizationOne(container: HTMLElement): Promise<HTMLSelectElement> {
    await press(container, "Search");
    const organization = controlFor<HTMLSelectElement>(container, "Organization");
    await chooseOption(organization, PICKED_ORGANIZATION_ID);
    await settle();
    return organization;
  }

  it("refuses an unpicked organization at the field, in the contract's words, and sends nothing", async () => {
    const requests = stubFetch(() => jsonResponse({ success: true }));
    const container = openGrantForm();

    await press(container, "Grant");

    expect(requests).toHaveLength(0);
    const organization = controlFor<HTMLSelectElement>(container, "Organization");
    expect(fieldOf(organization).classList.contains("pk-field--invalid")).toBe(true);
    expect(organization.getAttribute("aria-invalid")).toBe("true");
    const message = document.querySelector(`[id="${organization.getAttribute("aria-describedby") ?? ""}"]`);
    expect(message?.getAttribute("role")).toBe("alert");
    // The field says what the create contract — path and body together —
    // says about an organization that is not there.
    const contract = organizationIdentityCreateRequestSchema.safeParse({
      organizationId: "",
      userReference: "existing_user",
      userId: USER_ID,
      showOnOrganizationProfile: true,
      activation: { mode: "invitation" },
    });
    expect(contract.success).toBe(false);
    expect(message?.textContent).toContain(normalizeValidation(contract.error).fields.organizationId);
    expect(document.activeElement).toBe(organization);
  });

  it("grants an individual capacity through the member capacities contract, refusing a blank reason first", async () => {
    const requests = stubFetch(() =>
      jsonResponse({
        member: {
          id: MEMBER_ID,
          userId: USER_ID,
          organizationId: null,
          membershipCategory: "H5",
          status: "active",
          showOnOrgProfile: false,
        },
      }),
    );
    const container = openGrantForm();

    await chooseOption(controlFor<HTMLSelectElement>(container, "Category"), "H5");
    // Whitespace clears the browser's own `required` check, so the grant
    // contract is what refuses the blank reason — on its field, sending nothing.
    const reason = controlFor(container, "Activation reason");
    await typeInto(reason, "   ");
    await press(container, "Grant");

    expect(fieldOf(reason).classList.contains("pk-field--invalid")).toBe(true);
    expect(fieldOf(reason).querySelector('[role="alert"]')?.textContent).toContain(
      "Document why this identity is being activated immediately.",
    );
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);

    await typeInto(reason, "  Individual member since the 2026 AGM  ");
    await press(container, "Grant");

    const post = requests.find((request) => request.method === "POST");
    expect(post?.pathname).toBe("/api/v1/members/capacities");
    // Parsed through the route's own contract rather than compared to a
    // literal copy of what the form sent.
    expect(individualMembershipGrantSchema.parse(post?.body)).toEqual({
      userId: USER_ID,
      membershipCategory: "H5",
      activationReason: "Individual member since the 2026 AGM",
    });
  });

  it("marks the field a server refusal names, and keeps the form open", async () => {
    stubFetch((url) => {
      if (url.pathname === "/api/v1/organizations") return jsonResponse(organizationList);
      if (url.pathname === `/api/v1/organizations/${PICKED_ORGANIZATION_ID}`) return jsonResponse(organizationDetail);
      return fieldRefusal({ organizationId: ["That organization cannot take identities."] });
    });
    const container = openGrantForm();

    const organization = await pickOrganizationOne(container);
    await press(container, "Grant");

    expect(fieldOf(organization).classList.contains("pk-field--invalid")).toBe(true);
    expect(fieldOf(organization).querySelector('[role="alert"]')?.textContent).toContain(
      "That organization cannot take identities.",
    );
    expect(document.activeElement).toBe(organization);
    expect(buttonNamed(container, "Grant")).toBeDefined();
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

    expect(fieldOf(reason).classList.contains("pk-field--invalid")).toBe(true);
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
