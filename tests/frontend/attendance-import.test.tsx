import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { AttendanceImport } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AttendanceImport";
import { postJson } from "../../assets/ts/shared/api-client";
vi.mock("../../assets/ts/components/ApiDataTable", () => ({ ApiDataTable: () => null }));
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  postJson: vi.fn(),
}));
const review = {
  reviewId: "11111111-1111-4111-8111-111111111111",
  payloadHash: "a".repeat(64),
  rowCount: 1,
  captureContextHash: "b".repeat(64),
  captureContext: {
    timeZone: "Europe/Amsterdam",
    eventTimeZone: "Europe/Amsterdam",
    publicationRevision: 7,
    eventStartAt: null,
    eventEndAt: null,
    occurrences: [
      {
        occurrenceId: "33333333-3333-4333-8333-333333333333",
        startAt: "2026-01-01T10:00:00.000Z",
        endAt: "2026-01-01T11:00:00.000Z",
      },
    ],
    capturedDays: ["2026-01-01"],
  },
  reviewedAt: "2030-01-01T10:00:00.000Z",
  expiresAt: "2030-01-01T10:15:00.000Z",
};
const input = {
  source: "vendor_attendance",
  sourceReference: "export-1",
  rows: [
    {
      sourceRecordId: "row-1",
      userId: "22222222-2222-4222-8222-222222222222",
      occurrenceId: null,
      attendanceMode: "virtual",
      observedAt: "2026-01-01T10:00:00.000Z",
      verification: "unverified",
    },
  ],
};
describe("Reviewed attendance import", () => {
  it("requires review before explicit confirmation and invalidates review after editing", async () => {
    vi.mocked(postJson).mockReset();
    vi.mocked(postJson).mockResolvedValue(review);
    const host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<AttendanceImport slug="test" timeZone="UTC" onChanged={() => {}} />, host));
    expect(host.textContent).toContain("does not create admission");
    const format = host.querySelector('section[aria-label="Import format"]')!;
    expect(format.querySelector("h4")?.textContent).toBe("Import format");
    expect(format.textContent).toContain('"sourceRecordId"');
    expect(format.textContent).toContain("manual_evidence for reviewed physical evidence");
    expect(format.closest("details")).toBeNull();
    const textarea = host.querySelector("textarea")!;
    await act(() => {
      textarea.value = JSON.stringify(input);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postJson).mock.calls[0][0]).toContain("/attendance/imports/reviews");
    expect(host.textContent).toContain("Confirm import of 1 observations");
    expect(host.textContent).toContain("Europe/Amsterdam");
    expect(host.textContent).toContain("2026-01-01");
    const intervals = host.querySelector('section[aria-label="Reviewed session intervals"]')!;
    expect(intervals.querySelector("h4")?.textContent).toBe("Reviewed session intervals");
    expect(intervals.textContent).toContain(review.captureContext.occurrences[0]!.occurrenceId);
    expect(intervals.querySelectorAll("dd")).toHaveLength(1);
    expect(intervals.closest("details")).toBeNull();
    expect(host.querySelector("details, summary")).toBeNull();
    await act(() => {
      textarea.value = JSON.stringify({ ...input, sourceReference: "changed" });
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("Confirm import of 1 observations");
    render(null, host);
    host.remove();
  });
  it("submits only the reviewed hash/ID and calls refresh after explicit confirmation", async () => {
    vi.mocked(postJson).mockReset();
    vi.mocked(postJson).mockResolvedValueOnce(review).mockResolvedValueOnce({});
    const host = document.createElement("div"),
      changed = vi.fn();
    document.body.append(host);
    await act(() => render(<AttendanceImport slug="test" timeZone="UTC" onChanged={changed} />, host));
    await act(() => {
      const control = host.querySelector("textarea")!;
      control.value = JSON.stringify(input);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const confirm = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Confirm import"),
    )!;
    await act(async () => {
      confirm.click();
    });
    expect(vi.mocked(postJson).mock.calls[1][1]).toEqual({
      operationId: expect.any(String),
      reviewId: review.reviewId,
      payloadHash: review.payloadHash,
    });
    expect(changed).toHaveBeenCalledOnce();
    render(null, host);
    host.remove();
  });
});
