// @vitest-environment jsdom
/**
 * The account page's notification card: facts first, edited deliberately.
 *
 * A preference changes what mail a member receives, so the card opens showing
 * each choice as On or Off, edits only after the reader asks to, forgets an
 * abandoned draft, and sends only what the shared update contract accepts.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { myNotificationPreferencesUpdateSchema } from "../../assets/shared/schemas/me";
import { NotificationPreferencesCard } from "../../assets/ts/member-flows/portal/sections/NotificationPreferencesCard";
import { beginRecordEdit } from "./helpers/record-edit";
import { buttonNamed, controlFor, submitForm, toggleChoice } from "./helpers/labelled-control";

const ENDPOINT = "/api/v1/users/current/notifications/preferences";
const LABELS = [
  "Working group updates",
  "Vote reminders",
  "General consortium announcements",
  "Working group roster change digest (chairs & vice-chairs only, weekly)",
];

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

function standing(root: ParentNode): string[] {
  return [...root.querySelectorAll("dd")].map((value) => value.textContent ?? "");
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("notification preferences card", () => {
  it("opens as On and Off facts with no control to change them", async () => {
    stubApi({ ...allOn, voteReminders: false });
    const root = await mount();

    expect(root.querySelector('section[aria-label="Notification preferences"]')).not.toBeNull();
    expect(standing(root)).toEqual(["On", "Off", "On", "On"]);
    expect(root.querySelector("input")).toBeNull();
  });

  it("forgets an abandoned draft and opens again on the stored values", async () => {
    const { patches } = stubApi(allOn);
    const root = await mount();

    await beginRecordEdit(root, "Notification preference actions", "Edit settings");
    await toggleChoice(controlFor(root, LABELS[0]));
    expect(controlFor(root, LABELS[0]).checked).toBe(false);
    await act(async () => buttonNamed(root, "Cancel").click());

    expect(root.querySelector("input")).toBeNull();
    expect(standing(root)).toEqual(["On", "On", "On", "On"]);
    await beginRecordEdit(root, "Notification preference actions", "Edit settings");
    expect(LABELS.map((label) => controlFor(root, label).checked)).toEqual([true, true, true, true]);
    expect(patches).toEqual([]);
  });

  it("saves every choice through the shared update contract and shows the stored result", async () => {
    const { patches } = stubApi(allOn);
    const root = await mount();

    await beginRecordEdit(root, "Notification preference actions", "Edit settings");
    for (const label of LABELS) await toggleChoice(controlFor(root, label));
    await submitForm(root);
    await settle();

    expect(patches).toHaveLength(1);
    expect(myNotificationPreferencesUpdateSchema.parse(patches[0])).toEqual({
      workingGroupUpdates: false,
      voteReminders: false,
      generalAnnouncements: false,
      wgChairMembershipDigest: false,
    });
    expect(root.querySelector("input")).toBeNull();
    expect(standing(root)).toEqual(["Off", "Off", "Off", "Off"]);
  });

  it("states a refused save on the card and keeps the draft to correct", async () => {
    stubApi(allOn, () => json({ error: { code: "SERVER_ERROR", message: "Preferences could not be saved" } }, 500));
    const root = await mount();

    await beginRecordEdit(root, "Notification preference actions", "Edit settings");
    await toggleChoice(controlFor(root, LABELS[1]));
    await submitForm(root);
    await settle();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Preferences could not be saved");
    expect(controlFor(root, LABELS[1]).checked).toBe(false);
  });
});
