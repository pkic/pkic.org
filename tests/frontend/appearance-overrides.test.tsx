// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AppearanceOverrides } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AppearanceOverrides";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { appearanceOverrideRequestSchema } from "../../assets/shared/schemas/event-appearance-overrides";
const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => api);
const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  vi.clearAllMocks();
});
const user = crypto.randomUUID(),
  occurrenceId = crypto.randomUUID();
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "UTC",
  revision: 4,
  publishedRevision: 3,
  rooms: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
  occurrences: [],
});
const appearance = {
  userId: user,
  actingIdentityId: null,
  displayName: "Historic speaker",
  jobTitle: "Engineer",
  organizationName: "Historical organization",
  biography: "Conference biography",
  photoUrl: null,
  approvedAt: "2026-01-01T00:00:00.000Z",
};
describe("historical representation request form", () => {
  it("requires a meaningful reason and evidence before submitting the canonical request", async () => {
    api.getJson.mockResolvedValue({
      overrides: [],
      canReview: false,
      page: { limit: 50, offset: 0, total: 0, hasMore: false },
    });
    api.postJson.mockResolvedValue({
      id: crypto.randomUUID(),
      occurrenceId,
      appearance,
      reason: "Historical employer correction",
      evidence: "The archived program lists the historical employer",
      requestedBy: user,
      requestedAt: new Date().toISOString(),
      decision: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
    });
    const saved = vi.fn();
    await act(async () =>
      render(
        <AppearanceOverrides
          snapshot={snapshot}
          occurrenceId={occurrenceId}
          appearances={[appearance]}
          onSaved={saved}
        />,
        host,
      ),
    );
    expect(host.querySelector("form")).toBeNull();
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Request historical representation review")!
        .click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.querySelector("table")).toBeNull());
    const form = host.querySelector("form")!;
    expect(form).not.toBeNull();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(api.postJson).not.toHaveBeenCalled();
    await act(async () => {
      for (const [name, value] of [
        ["reason", "Historical employer correction"],
        ["evidence", "The archived program lists the historical employer"],
      ]) {
        const input = host.querySelector<HTMLTextAreaElement>(`textarea[name='${name}']`)!;
        input.value = value!;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(api.postJson).toHaveBeenCalledTimes(1);
    const body = api.postJson.mock.calls[0]![1];
    expect(appearanceOverrideRequestSchema.parse(body)).toMatchObject({
      expectedRevision: 4,
      appearance: { userId: user, organizationName: "Historical organization" },
    });
    expect(saved).not.toHaveBeenCalled();
  });
});
