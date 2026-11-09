import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registrationInviteCreateSchema } from "../../assets/shared/schemas/registration";
import { ParticipantEvent } from "../../assets/ts/member-flows/portal/sections/events/ParticipantEvent";
import { participantEventFixture, registeredParticipant } from "../helpers/participant-event";
import { portalSessionFixture } from "../helpers/portal-session";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { buttonNamed, controlFor, typeInto } from "./helpers/labeled-control";

// Artwork has its own tests; exercise the real page, share panel, and invite dialog here.
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/agenda/PersonalPromotionKit", () => ({
  PersonalPromotionKit: () => null,
}));

let host: HTMLElement;
let sent: unknown[];
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  sent = [];
  history.replaceState(null, "", "/portal/#/events/summit/promotion");
  portalSession.value = portalSessionFixture({ member: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-11-01T00:00:00.000Z");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push(registrationInviteCreateSchema.parse(JSON.parse(String(init.body))));
        expect(new Headers(init.headers).has("authorization")).toBe(false);
        return Response.json({
          success: true,
          created: [{ email: "colleague@example.test" }],
          endorsed: [],
          skipped: [],
        });
      }
      return Response.json({ sessions: [], page: { limit: 5, offset: 0, total: 0, hasMore: false } });
    }),
  );
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

function event() {
  return participantEventFixture({
    ...registeredParticipant,
    startsAt: "2026-12-01T08:00:00.000Z",
    endsAt: "2026-12-02T17:00:00.000Z",
    participation: {
      ...registeredParticipant.participation,
      promotion: { sharePath: "/r/ABC123", badgeVersion: "2026-11-01T00:00:00.000Z" },
    },
  });
}

it("keeps invitations on Share & Invite and out of Overview", async () => {
  await act(() => render(<ParticipantEvent event={event()} tab="overview" />, host));
  await vi.waitFor(() => expect(host.textContent).toContain("Show ticket"));
  expect(host.textContent).not.toContain("Invite a colleague");
  await act(() => render(<ParticipantEvent event={event()} tab="promotion" />, host));
  await vi.waitFor(() => expect(host.textContent).toContain("Invite a colleague"));
  expect(sent).toHaveLength(0);
  expect(host.textContent).toContain("Share & Invite");
  expect(host.textContent).toContain("Share on LinkedIn");
  await act(() => buttonNamed(host, "Invite a colleague").click());
  await vi.waitFor(() => expect(document.querySelector("dialog[open]")).not.toBeNull());
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
  await act(() => buttonNamed(dialog, "Send invites").click());
  expect(sent).toHaveLength(0);
  expect(controlFor(dialog, "Invite 1 email address").getAttribute("aria-invalid")).toBe("true");
  await typeInto(controlFor(dialog, "Invite 1 email address"), "colleague@example.test");
  await act(() => buttonNamed(dialog, "Send invites").click());
  expect(sent).toHaveLength(1);
  await vi.waitFor(() => expect(dialog.textContent).toContain("Queued 1 invitation"));
});

it("hides Share & Invite invitations at and after the start or without a confirmed registration", async () => {
  const detail = event();
  for (const now of ["2026-12-01T08:00:00.000Z", "2026-12-03T08:00:00.000Z"]) {
    vi.setSystemTime(now);
    await act(() => render(<ParticipantEvent event={detail} tab="promotion" />, host));
    await vi.waitFor(() => expect(host.querySelector(".pk-event-hero")).not.toBeNull());
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Invite a colleague")).toBe(false);
  }
  vi.setSystemTime("2026-11-01T00:00:00.000Z");
  detail.participation!.registrationStatus = "pending_email_confirmation";
  detail.viewer!.registrationStatus = "pending_email_confirmation";
  await act(() => render(<ParticipantEvent event={detail} tab="promotion" />, host));
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Invite a colleague")).toBe(false);
});

it("hides invitations on the open Share & Invite page when the event starts", async () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-12-01T07:59:50.000Z");
  await act(() => render(<ParticipantEvent event={event()} tab="promotion" />, host));
  await vi.waitFor(() => expect(host.textContent).toContain("Invite a colleague"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_251);
  });
  expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Invite a colleague")).toBe(
    false,
  );
});
