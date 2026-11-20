// @vitest-environment jsdom
/**
 * The person's open invitations on Home: each card carries the event's own
 * wording beside its date and place and leads to registration; the first
 * invitation that is not postponed asks once per visit in a dialog.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventInvitationCards } from "../../assets/ts/member-flows/portal/sections/EventInvitationCards";
import { inviteReminderPreferenceSchema } from "../../assets/shared/schemas/invites";
import { inviteDeclineSchema } from "../../assets/shared/schemas/registration";
import { audienceEventRow } from "./helpers/event-list-fixtures";

const INVITE_ID = "30000000-0000-4000-8000-000000000001";
const page = { limit: 6, offset: 0, total: 1, hasMore: false };

function invitedRow(overrides: Record<string, unknown> = {}, remindersPausedUntil: string | null = null) {
  return audienceEventRow({
    registrationPolicy: "invitation_only",
    visibility: "invitation_only",
    participation: {
      registrationId: null,
      registrationStatus: null,
      proposals: 0,
      speakerProposals: 0,
      invitation: { id: INVITE_ID, remindersPausedUntil },
    },
    ...overrides,
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

let served: unknown[] | "fail" = [];

/** Serves the upcoming events list, and records each invitation answer. */
function stub(events: unknown[] | "fail") {
  served = events;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/api/v1/events") {
      expect(url.searchParams.get("invitation")).toBe("open");
      return served === "fail" ? new Response("", { status: 503 }) : json({ events: served, page });
    }
    if (url.pathname.endsWith("/reminders")) return json({ success: true, state: "postponed", pausedUntil: null });
    if (url.pathname.endsWith("/decline")) return json({ success: true, forwarded: [] });
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const mounted: HTMLElement[] = [];
async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => render(<EventInvitationCards />, container));
  await settle();
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event invitation cards", () => {
  it("asks about an invitation in a dialog and keeps its card with one action", async () => {
    stub([invitedRow()]);
    const container = await mount();
    const card = container.querySelector(".blog-card-body");
    expect(card?.querySelector("strong")?.textContent).toBe("You're invited to PQC Conference 2026");
    // The date sits beside the action in the body, not in the photo header.
    expect(card?.textContent).toContain("December 1, 2026");
    expect(container.querySelector(".event-card-location")).toBeNull();
    expect(
      [...(card?.querySelectorAll("a") ?? [])].map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([["Register now", "#/events/pqc-2026/register"]]);
    const dialog = container.querySelector("dialog");
    expect(dialog?.querySelector(".pk-dialog__title")?.textContent).toBe("You're invited to PQC Conference 2026");
    expect([...(dialog?.querySelectorAll(".pk-dialog__foot :is(a,button)") ?? [])].map((c) => c.textContent)).toEqual([
      "I can't attend",
      "Remind me next week",
      "Register now",
    ]);
  });

  it("shows the event's own headline and Markdown message", async () => {
    stub([
      invitedRow({
        invitationMessage: {
          headline: "Join the PQC migration leaders",
          message: "Two days of **hands-on** sessions.",
        },
      }),
    ]);
    const container = await mount();
    const card = container.querySelector(".blog-card-body");
    // The headline, then the Markdown message rendered.
    expect([...(card?.querySelectorAll("strong") ?? [])].map((node) => node.textContent)).toEqual([
      "Join the PQC migration leaders",
      "hands-on",
    ]);
    expect(card?.textContent).toContain("Two days of hands-on sessions.");
    expect(container.querySelector(".pk-dialog__title")?.textContent).toBe("Join the PQC migration leaders");
    expect(container.querySelector("dialog strong")?.textContent).toBe("hands-on");
  });

  it("postpones the invitation for a week, and the card stays", async () => {
    const fetchMock = stub([invitedRow()]);
    const container = await mount();
    served = [invitedRow({}, new Date(Date.now() + 7 * 86_400_000).toISOString())];
    await act(() => button(container, "Remind me next week").click());
    await settle();
    const [, init] = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/reminders")) ?? [];
    expect(inviteReminderPreferenceSchema.parse(JSON.parse(String(init?.body))).action).toBe("postpone_7d");
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("Register now");
  });

  it("does not ask while the invitation is postponed", async () => {
    stub([invitedRow({}, new Date(Date.now() + 86_400_000).toISOString())]);
    const container = await mount();
    expect(container.textContent).toContain("Register now");
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("asks why before declining, then declines with the answer and drops the card", async () => {
    const fetchMock = stub([invitedRow()]);
    const container = await mount();
    await act(() => button(container, "I can't attend").click());
    expect(container.querySelector(".pk-dialog__title")?.textContent).toBe("Not able to make it?");
    // The reason is required by the shared contract; nothing is sent without it.
    await act(() => button(container, "Decline this invitation").click());
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/decline"))).toBe(false);
    const reason = container.querySelector<HTMLInputElement>('input[value="schedule_conflict"]')!;
    await act(() => reason.click());
    served = [];
    await act(() => button(container, "Decline this invitation").click());
    await settle();
    const declined = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/decline"));
    expect(inviteDeclineSchema.parse(JSON.parse(String(declined?.[1]?.body))).reasonCode).toBe("schedule_conflict");
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("says so when the upcoming events cannot be read", async () => {
    stub("fail");
    const container = await mount();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
