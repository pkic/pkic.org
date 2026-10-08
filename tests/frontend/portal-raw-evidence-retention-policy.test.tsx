// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawEvidenceRetentionPolicy } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/RawEvidenceRetentionPolicy";
import { eventEvidenceRetentionPolicyUpdateSchema } from "../../assets/shared/schemas/event-evidence-retention";
import type { EventDetail } from "../../assets/ts/member-flows/portal/sections/events/types";
const auth = vi.hoisted(() => ({ read: true, write: true }));
vi.mock("../../assets/ts/member-flows/portal/state", () => ({ portalSession: { value: {} } }));
vi.mock("../../assets/ts/member-flows/portal/shell/portal-navigation", () => ({
  portalHasGlobalPermission: (_: unknown, permission: string) =>
    permission === "retention:read" ? auth.read : auth.write,
}));
const event = {
  id: "10000000-0000-4000-8000-000000000001",
  timezone: "Europe/Amsterdam",
  capabilities: ["manage"],
} as EventDetail;
const initial = {
  success: true,
  eventId: event.id,
  revision: 1,
  policy: {
    evidenceUntil: "2026-10-04T12:00:00.000Z",
    purposeCode: "attendance_review",
    legalHold: false,
    holdReasonCode: null,
  },
  captureClosedAt: null,
  purgedAt: null,
  status: "retained",
};
let container: HTMLElement;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(detail = event) {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(<RawEvidenceRetentionPolicy event={detail} />, container));
  await settle();
}
afterEach(() => {
  if (container) {
    void act(() => render(null, container));
    container.remove();
  }
  auth.read = true;
  auth.write = true;
  vi.unstubAllGlobals();
});
describe("raw evidence retention policy form", () => {
  it("shows friendly labels, converts the event timezone, and submits the canonical UTC body", async () => {
    let captured: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: unknown, options?: RequestInit) => {
        if (options?.method === "PUT") {
          captured = JSON.parse(String(options.body));
          return response({ success: true, eventId: event.id, revision: 2, policy: initial.policy });
        }
        return response(initial);
      }),
    );
    await mount();
    expect(container.textContent).toContain("Pause evidence removal");
    expect(container.textContent).toContain("Review attendance and scan records");
    expect(container.textContent).not.toContain("Legal hold");
    const cutoff = container.querySelector<HTMLInputElement>('input[name="evidenceUntil"]')!;
    expect(cutoff.value).toBe("2026-10-04T14:00");
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(eventEvidenceRetentionPolicyUpdateSchema.parse(captured)).toMatchObject({
      evidenceUntil: "2026-10-04T12:00:00.000Z",
      purposeCode: "attendance_review",
      expectedRevision: 1,
    });
  });
  it("preserves the edited deadline after a failed save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: unknown, options?: RequestInit) =>
        options?.method === "PUT"
          ? response({ error: { code: "RETENTION_POLICY_REVISION_CHANGED", message: "Reload before saving." } }, 409)
          : response(initial),
      ),
    );
    await mount();
    const cutoff = container.querySelector<HTMLInputElement>('input[name="evidenceUntil"]')!;
    void act(() => {
      cutoff.value = "2026-10-05T15:00";
      cutoff.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(cutoff.value).toBe("2026-10-05T15:00");
    expect(container.textContent).toContain("Reload before saving.");
  });
  it("requires both retention read and event management, and keeps configuration read-only without run authority", async () => {
    const fetch = vi.fn(async () => response(initial));
    vi.stubGlobal("fetch", fetch);
    auth.read = false;
    await mount();
    expect(fetch).not.toHaveBeenCalled();
    auth.read = true;
    void act(() => render(<RawEvidenceRetentionPolicy event={{ ...event, capabilities: ["read"] }} />, container));
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    auth.write = false;
    void act(() => render(<RawEvidenceRetentionPolicy event={event} />, container));
    await settle();
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });
});
