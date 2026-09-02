/**
 * Fixtures the event-management tests share: one group, one event as the
 * server would answer, a mount that remembers what to unmount.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";
import type { GroupEvent } from "../../../assets/shared/schemas/group-events";

export const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

export function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

export function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export const responseEvent: GroupEvent = {
  id: "architecture-workshop",
  ownerGroupId: GROUP_ID,
  seriesId: null,
  slug: "architecture-workshop",
  basePath: null,
  name: "Architecture workshop",
  timezone: "Europe/Amsterdam",
  startsAt: "2026-09-01T15:00:00.000Z",
  endsAt: "2026-09-01T16:00:00.000Z",
  profileKey: "workshop",
  sourceMode: "portal",
  registrationPolicy: "no_registration",
  visibility: "group_members",
  inviteLimitAttendee: 5,
  location: "Online",
  links: ["https://example.test/architecture-workshop"],
  nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "manage"],
};

/** Unmounts everything `mount` rendered and drops stubbed globals; call from afterEach. */
export function cleanup(): void {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
}
