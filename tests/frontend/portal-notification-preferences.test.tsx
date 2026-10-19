// @vitest-environment jsdom
/**
 * The notification panel on the user record: choices saved as they are made.
 *
 * A preference changes what mail a member receives, so each choice is a
 * checkbox that saves on change through the shared update contract, with no
 * edit mode to forget, and returns to the stored value when a save is refused.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { myNotificationPreferencesUpdateSchema } from "../../assets/shared/schemas/me";
import { NotificationPreferencesCard } from "../../assets/ts/member-flows/portal/sections/NotificationPreferencesCard";
import { toggleChoice } from "./helpers/labeled-control";

const ENDPOINT = "/api/v1/users/current/notifications/preferences";
const CHOICES = ["workingGroupUpdates", "voteReminders", "generalAnnouncements", "wgChairMembershipDigest"] as const;

/** A choice's checkbox, found by the preference it sets. */
function choice(root: ParentNode, name: (typeof CHOICES)[number]): HTMLInputElement {
  return root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function standing(root: ParentNode): boolean[] {
  return CHOICES.map((name) => choice(root, name).checked);
}

const allOn = {
  workingGroupUpdates: true,
  voteReminders: true,
  generalAnnouncements: true,
  wgChairMembershipDigest: true,
};

let container: HTMLElement | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Serves the stored preferences and records each PATCH body a reader sends. */
function stubApi(stored: Record<string, boolean>, refuse?: () => Response): { patches: unknown[] } {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input), location.origin).pathname).toBe(ENDPOINT);
      if (init?.method !== "PATCH") return json(stored);
      patches.push(JSON.parse(String(init.body)));
      return refuse ? refuse() : json({ ...stored, ...(patches.at(-1) as object) });
    }),
  );
  return { patches };
}

async function mount(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(() => render(<NotificationPreferencesCard />, container!));
  await settle();
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("notification preferences panel", () => {
  it("opens as checkboxes on the stored values, with no On or Off text and no menu", async () => {
    stubApi({ ...allOn, voteReminders: false });
    const root = await mount();

    expect(root.querySelector('section[aria-label="Email notifications"]')).not.toBeNull();
    expect(standing(root)).toEqual([true, false, true, true]);
    expect(root.textContent).toContain("Weekly, for chairs and vice-chairs");
    expect(root.textContent).not.toMatch(/\b(On|Off)\b/);
    expect(root.querySelector("button")).toBeNull();
  });

  it("saves a change at once through the shared update contract", async () => {
    const { patches } = stubApi(allOn);
    const root = await mount();

    await toggleChoice(choice(root, "workingGroupUpdates"));
    await settle();

    expect(patches).toHaveLength(1);
    expect(myNotificationPreferencesUpdateSchema.parse(patches[0])).toEqual({ workingGroupUpdates: false });
    expect(standing(root)).toEqual([false, true, true, true]);
  });

  it("returns the box to the stored value when the save is refused", async () => {
    const { patches } = stubApi(allOn, () =>
      json({ error: { code: "SERVER_ERROR", message: "Preferences could not be saved" } }, 500),
    );
    const root = await mount();

    await toggleChoice(choice(root, "voteReminders"));
    await settle();

    expect(patches).toHaveLength(1);
    expect(choice(root, "voteReminders").checked).toBe(true);
  });
});
