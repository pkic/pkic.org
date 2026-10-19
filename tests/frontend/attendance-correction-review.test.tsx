import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { AttendanceCorrectionReview } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AttendanceEvidence";
import { postJson } from "../../assets/ts/shared/api-client";
vi.mock("../../assets/ts/components/ApiDataTable", () => ({ ApiDataTable: () => null }));
vi.mock("../../assets/ts/shared/api-client", () => ({ postJson: vi.fn(async () => ({})) }));
const observation = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  displayName: "Attendee",
  occurrenceId: null,
  observedAt: "2030-01-01T10:00:00.000Z",
  receivedAt: "2030-01-01T10:01:00.000Z",
  operatorUserId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
  source: "browser_scan" as const,
  action: "attendance",
  deviceTimeVerified: false as const,
  captureContext: { state: "missing" as const, reason: "not_captured" as const },
  revision: 0,
  voided: false,
};
describe("Attendance evidence correction review", () => {
  it("shows original provenance and uncertainty without correction controls for read-only staff", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <AttendanceCorrectionReview
          slug="test"
          observation={observation}
          timeZone="UTC"
          canCorrect={false}
          onChanged={() => {}}
        />,
        host,
      ),
    );
    expect(host.textContent).toContain("Device time is unverified");
    expect(host.textContent).toContain("Server receipt");
    expect(host.querySelector("form")).toBeNull();
    render(null, host);
    host.remove();
  });
  it("submits an explicit attributed exclusion with the current revision", async () => {
    const host = document.createElement("div"),
      changed = vi.fn();
    document.body.append(host);
    await act(() =>
      render(
        <AttendanceCorrectionReview
          slug="test"
          observation={observation}
          timeZone="UTC"
          canCorrect
          onChanged={changed}
        />,
        host,
      ),
    );
    expect(host.querySelector("form")?.noValidate).toBe(true);
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postJson).toHaveBeenCalledWith(
      expect.stringContaining(`/observations/${observation.id}/corrections`),
      expect.objectContaining({
        expectedRevision: 0,
        kind: "void",
        reasonCode: "operator_error",
        operationId: expect.any(String),
      }),
      expect.anything(),
    );
    expect(changed).toHaveBeenCalledOnce();
    render(null, host);
    host.remove();
  });
});
