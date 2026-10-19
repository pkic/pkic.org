// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { AttendanceSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/AttendanceSettings";
import { beginRecordEdit } from "./helpers/record-edit";
import { controlFor, typeInto } from "./helpers/labeled-control";

const event = eventDetailSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  slug: "summit",
  name: "Summit",
  timezone: "Europe/Amsterdam",
  startsAt: null,
  endsAt: null,
  profileKey: "conference",
  registrationPolicy: "public",
  visibility: "public",
  inviteLimitAttendee: 5,
  updatedAt: "2026-08-29T00:00:00.000Z",
  basePath: null,
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  city: null,
  country: null,
  sessionTypes: null,
  ownerGroupId: null,
  sourceMode: "portal",
  seriesId: null,
  links: [],
  capabilities: ["read", "write"],
  settings: {},
});
let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

async function submit() {
  await act(async () => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("shows the default minimum stay and saves a new one through the settings contract", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ event: { ...event, settings: { attendance: { minimumStayPercent: 60 } } } });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<AttendanceSettings event={event} onUpdated={() => {}} />, root));
  expect(root.textContent).toContain("50% of the session");

  await beginRecordEdit(root, "Attendance settings actions");
  const percent = controlFor<HTMLInputElement>(root, "Minimum stay (% of the session)");
  await typeInto(percent, "5");
  await submit();
  expect(sent).toHaveLength(0);
  expect(root.textContent).toContain("Enter at least 10%.");

  await typeInto(percent, "60");
  await submit();
  expect(eventSettingsUpdateSchema.parse(sent[0]).attendance).toEqual({ minimumStayPercent: 60 });
});
