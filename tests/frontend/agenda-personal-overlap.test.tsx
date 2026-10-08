import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { PersonalAgendaStatus } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/PersonalAgendaStatus";
import { personalAgendaSessionSchema } from "../../assets/shared/schemas/event-personal-agenda";
const host = document.createElement("div");
afterEach(() => render(null, host));
const session = personalAgendaSessionSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Workshop",
  publishedRevision: 1,
  timeZone: "UTC",
  startAt: "2027-01-20T09:00:00.000Z",
  endAt: "2027-01-20T10:00:00.000Z",
  admissionPolicy: "reservation",
  status: "reserved",
  attendanceMode: "physical",
  saved: true,
  overlapCount: 2,
  overlaps: [{ id: "22222222-2222-4222-8222-222222222222", title: "Parallel panel", status: "saved" }],
});
describe("Personal agenda preference warnings", () => {
  it("distinguishes confirmed allocation and saved interest while explaining overlap without forbidding preferences", () => {
    render(<PersonalAgendaStatus session={session} />, host);
    expect(host.textContent).toContain("Reserved");
    expect(host.textContent).toContain("Saved preference");
    expect(host.querySelector('[role="note"]')?.textContent).toContain("Overlaps with your agenda");
    expect(host.textContent).toContain("Parallel panel — Saved preference");
    expect(host.textContent).toContain("And 1 more");
    expect(host.textContent).toContain("You can keep overlapping preferences");
  });
  it("shows friendly approval state and no warning when intervals do not overlap", () => {
    render(
      <PersonalAgendaStatus
        session={{ ...session, status: "approval_pending", saved: false, overlapCount: 0, overlaps: [] }}
      />,
      host,
    );
    expect(host.textContent).toBe("Awaiting approval");
    expect(host.querySelector('[role="note"]')).toBeNull();
  });
});
