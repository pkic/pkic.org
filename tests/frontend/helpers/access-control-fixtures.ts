/**
 * Fixtures and drivers shared by the access-control component suites: the
 * records a grants list, a role and its assignees are drawn from, and the
 * search-and-select a reader performs to pick a person.
 */
import { act } from "preact/test-utils";
import { vi } from "vitest";

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function apiError(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function pathOf(input: RequestInfo | URL): string {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(href, location.origin).pathname;
}

export const GRANT = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  userEmail: "staff@example.test",
  permission: "access:grant",
  contextType: null,
  contextId: null,
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const CANDIDATE = {
  id: "30000000-0000-4000-8000-000000000001",
  email: "grace@example.test",
  first_name: "Grace",
  last_name: "Hopper",
  organization_name: null,
};

export const ROLE = {
  id: "role-custom-1",
  name: "custom_reviewer",
  description: "Reviews things",
  isSystemRole: false,
  permissions: ["events:read", "events:write"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const ASSIGNMENT = {
  userRoleId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
  email: "ada@example.test",
  contextType: null,
  contextId: null,
  expiresAt: null,
  createdAt: "2026-01-02T00:00:00.000Z",
};

/** Drives the debounced UserPicker to a selection, as a reader would. */
export async function pickCandidate(container: HTMLElement): Promise<void> {
  vi.useFakeTimers();
  const search = container.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
  void act(() => {
    search.value = "grace";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  vi.useRealTimers();
  await settle();
  const option = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(CANDIDATE.email),
  );
  if (!option) throw new Error("UserPicker offered no match");
  void act(() => option.click());
}
