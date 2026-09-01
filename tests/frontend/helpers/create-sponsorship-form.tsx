/**
 * Shared harness for the create-sponsorship form specs.
 *
 * The form's tests split across two files — what it offers and sends, and
 * how it refuses — but both stand in the same world: the canonical
 * organization and event list fixtures, a fetch stub that serves those lists
 * and captures the create, and one mount/cleanup lifecycle. That world lives
 * here once.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";

import type { Sponsorship } from "../../../assets/shared/schemas/sponsorship-management";
import { CreateSponsorshipForm } from "../../../assets/ts/member-flows/portal/sections/sponsors/management/CreateSponsorshipForm";
import { portalSession } from "../../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../../helpers/portal-session";

export const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
export const EVENT_ID = "pqc-conference-2026";
export const NOW = "2026-08-31T09:00:00.000Z";

export const CREATED: Sponsorship = {
  id: "30000000-0000-4000-8000-000000000001",
  sponsorType: "consortium",
  organizationId: ORGANIZATION_ID,
  organizationName: "Example Organization",
  nonMemberName: null,
  nonMemberWebsite: null,
  nonMemberLogoUrl: null,
  contactName: null,
  contactEmail: null,
  eventId: null,
  eventName: null,
  tier: null,
  pipelineStage: "new_inquiry",
  startDate: null,
  renewalDate: null,
  assignedToUserId: null,
  assignedToName: null,
  notes: null,
  priceAmountCents: null,
  priceCurrency: null,
  createdAt: NOW,
  updatedAt: NOW,
};

/** One directory page, shaped like the canonical organizations list contract. */
export function organizationsPage() {
  return {
    organizations: [
      {
        id: ORGANIZATION_ID,
        name: "Example Organization",
        membershipCategory: "P1",
        memberSince: "2020-01-01",
        activeIdentityCount: 3,
        primaryContactName: null,
        primaryContactEmail: null,
        createdAt: NOW,
        updatedAt: NOW,
        website: null,
        description: null,
        slogan: null,
        logoUrl: null,
      },
    ],
    page: { limit: 25, offset: 0, total: 1, count: 1, hasMore: false },
  };
}

/** One events page, shaped like the canonical events list contract (management arm). */
export function eventsPage() {
  return {
    events: [
      {
        id: EVENT_ID,
        slug: "pqc-conference-2026",
        name: "PQC Conference 2026",
        timezone: "Europe/Amsterdam",
        startsAt: "2026-10-01T08:00:00.000Z",
        endsAt: null,
        profileKey: "conference",
        sourceMode: "portal",
        registrationPolicy: "optional",
        visibility: "public",
        inviteLimitAttendee: 5,
        updatedAt: NOW,
        ownerGroupId: null,
        ownerGroupName: null,
        sourcePath: null,
        basePath: null,
        totalRegistrations: 0,
        confirmedRegistrations: 0,
        pendingInvites: 0,
      },
    ],
    page: { limit: 25, offset: 0, total: 1, count: 1, hasMore: false },
  };
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

export function mountForm(props: Partial<Parameters<typeof CreateSponsorshipForm>[0]> = {}): HTMLElement {
  return mount(<CreateSponsorshipForm onCreated={vi.fn()} onCancel={vi.fn()} {...props} />);
}

/** The toast area the portal shell would otherwise provide. */
export function installToastArea(): HTMLElement {
  const toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(toastArea);
  return toastArea;
}

/** Lets the pickers' initial collection fetches land before interacting. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Serves the canonical organization and event lists to the pickers, captures
 * every POST body into `bodies`, and answers the create with `status`.
 */
export function stubFetch(bodies: unknown[], status = 200, requests: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url.pathname}`);
      const json = (value: unknown, code = 200) =>
        new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json" } });

      if (method === "GET" && url.pathname === "/api/v1/organizations") return json(organizationsPage());
      if (method === "GET" && url.pathname === "/api/v1/events") return json(eventsPage());

      bodies.push(JSON.parse(String(init?.body)));
      if (status !== 200) {
        return json({ error: { code: "forbidden", message: `HTTP ${String(status)}` } }, status);
      }
      return json({ sponsorship: CREATED });
    }),
  );
}

/** The pickers are offered to accounts that can read the organization directory. */
export function signInAsDirectoryReader(): void {
  portalSession.value = portalSessionFixture({ staff: true });
}

/** The whole world this harness set up, taken back down. Call from `afterEach`. */
export function cleanupForm(): void {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  document.getElementById("portal-toast-area")?.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
}
