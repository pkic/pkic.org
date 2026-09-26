/**
 * The fixtures and small helpers both affiliation suites work from.
 *
 * The row and the panel are two subjects — one tie, and the collection of them
 * — and their tests outgrew a single file. What they share is a membership
 * shape, a mount, and a `fetch` stub; keeping it here means the split is one
 * of subject rather than a copy of two hundred lines of scaffolding.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, vi } from "vitest";
import type { UserDetail, UserMembership } from "../../../assets/ts/member-flows/portal/sections/system-users/model";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
} from "../../../assets/shared/schemas/organization-management";
import { buttonNamed } from "./labelled-control";
import { menuItemNamed } from "./row-actions";

export const USER_ID = "00000000-0000-4000-8000-000000000001";
export const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000002";
export const IDENTITY_ID = "00000000-0000-4000-8000-000000000003";
export const MEMBER_ID = "00000000-0000-4000-8000-000000000004";
export const GROUP_ID = "00000000-0000-4000-8000-000000000005";
export const PICKED_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000006";

export const mounted: HTMLElement[] = [];

export function membership(overrides: Partial<UserMembership> = {}): UserMembership {
  return {
    identityId: IDENTITY_ID,
    memberId: MEMBER_ID,
    membershipCategory: "A",
    status: "active",
    showOnOrgProfile: true,
    isDefault: false,
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

export function userWith(identities: UserMembership[]): UserDetail {
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

export function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  return container;
}

/**
 * The portal's toast target. `toast()` drops its message when the area is
 * absent, so a failure reported only through a toast would assert nothing.
 */
export function toastArea(): HTMLElement {
  const area = document.createElement("div");
  area.id = "portal-toast-area";
  document.body.append(area);
  mounted.push(area);
  return area;
}

export function describedByText(control: HTMLElement): string {
  const id = control.getAttribute("aria-describedby");
  if (!id) throw new Error("control carries no aria-describedby");
  return document.querySelector(`[id="${id}"]`)?.textContent ?? "";
}

/** Lets a started request and the re-render it causes settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Presses a button and waits for whatever it started. */
export async function press(root: ParentNode, label: string): Promise<void> {
  await act(() => buttonNamed(root, label).click());
  await settle();
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The Worker's error envelope, so `ApiClientError` carries the real reason. */
export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { code: "CONFLICT", message } }, status);
}

/** A validation refusal that names its fields, as the Worker sends one. */
export function fieldRefusal(fieldErrors: Record<string, string[]>): Response {
  return jsonResponse({ error: { code: "VALIDATION", message: "Invalid request", details: { fieldErrors } } }, 400);
}

export function fieldOf(control: HTMLElement): HTMLElement {
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
export function stubFetch(respond: (url: URL) => Response): CapturedRequest[] {
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

export function identityMutation(state: "active" | "ended"): Response {
  return jsonResponse({ success: true, identityId: IDENTITY_ID, state });
}

export const organizationList = organizationsListResponseSchema.parse({
  organizations: [
    {
      id: PICKED_ORGANIZATION_ID,
      name: "Organization One",
      publicProfileHref: "/members/profile/?id=org-1",
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

export const organizationDetail = organizationDetailResponseSchema.parse({
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
export function menuTrigger(container: HTMLElement, label: string): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`no menu is named "${label}"`);
  return trigger;
}

/** Opens one affiliation's menu and runs the item reading exactly `label`. */
export function runRowMenuAction(container: HTMLElement, organization: string, label: string) {
  void act(() => menuTrigger(container, `Actions for ${organization}`).click());
  const item = menuItemNamed(container, label);
  if (!item) throw new Error(`the row for "${organization}" offers no "${label}"`);
  void act(() => item.click());
}
