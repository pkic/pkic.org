// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentChildren } from "preact";
import { SessionBookings } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/SessionBookings";
import { CalendarReplyBadge } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/CalendarReplyReceipt";
import { sessionBookingRowSchema } from "../../assets/shared/schemas/event-participation-reporting";
const participant = sessionBookingRowSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000002",
  displayName: "Synthetic attendee",
  attendanceMode: "physical",
  status: "approval_pending",
  createdAt: "2026-10-01T10:00:00.000Z",
  calendarReplyDisposition: "needs_review",
  calendarReplyResponse: "accepted",
  calendarReplyReceivedAt: "2026-10-01T11:00:00.000Z",
});
vi.mock("../../assets/ts/components/ApiDataTable", () => ({
  ApiDataTable: ({
    columns,
    toolbar,
    rowAction,
  }: {
    columns: Array<{ header: string; cell?: (row: typeof participant) => ComponentChildren }>;
    toolbar?: () => ComponentChildren;
    rowAction?: (row: typeof participant) => { label: string; onSelect: () => void };
  }) => (
    <section>
      <div role="toolbar">{toolbar?.()}</div>
      <table>
        <tbody>
          <tr>
            {columns.map((column) => (
              <td>{column.cell?.(participant)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      {rowAction && <button onClick={rowAction(participant).onSelect}>{rowAction(participant).label}</button>}
    </section>
  ),
}));
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

it("shows the latest receipt without inline forms and opens a dedicated participant review", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await act(() => render(<SessionBookings slug="event" occurrenceId="session" />, host));
  expect(host.textContent).toContain("Reply needs review");
  expect(host.querySelector("table")).not.toBeNull();
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).not.toContain("Approve registration");
  expect(fetcher).not.toHaveBeenCalled();
  await act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "View participation for Synthetic attendee")!
      .click(),
  );
  expect(host.querySelector("table")).toBeNull();
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("This calendar reply could not be applied automatically");
  expect(host.textContent).toContain("Accepted");
  expect(host.querySelector("time")?.dateTime).toBe(participant.calendarReplyReceivedAt);
  expect(host.textContent).toContain("Approve registration");
  expect(host.textContent).not.toContain(participant.userId);
  expect(fetcher).not.toHaveBeenCalled();
});

it("distinguishes all receipt dispositions and absent replies without implying booking success", async () => {
  host = document.createElement("div");
  document.body.append(host);
  for (const [disposition, label] of [
    ["applied", "Reply applied"],
    ["tentative", "Tentative reply"],
    ["needs_review", "Reply needs review"],
    ["rejected", "Reply rejected"],
  ] as const) {
    await act(() =>
      render(<CalendarReplyBadge participant={{ ...participant, calendarReplyDisposition: disposition }} />, host),
    );
    expect(host.textContent).toBe(label);
  }
  await act(() =>
    render(<CalendarReplyBadge participant={{ ...participant, calendarReplyDisposition: undefined }} />, host),
  );
  expect(host.textContent).toBe("No reply received");
});
