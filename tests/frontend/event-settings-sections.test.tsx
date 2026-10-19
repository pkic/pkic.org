// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { GeneralTab } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/GeneralTab";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { groupEventSchema, groupEventSettingsUpdateSchema } from "../../assets/shared/schemas/group-events";
import { controlFor, typeInto } from "./helpers/labeled-control";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: vi.fn() }));
import { beginRecordEdit } from "./helpers/record-edit";
const host = document.createElement("div");
const event = eventDetailSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  city: null,
  country: null,
  startsAt: null,
  endsAt: null,
  profileKey: "workshop",
  basePath: null,
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  ownerGroupId: null,
  seriesId: null,
  links: [],
  slug: "synthetic",
  name: "Synthetic",
  timezone: "UTC",
  updatedAt: "2026-10-12T00:00:00.000Z",
  capabilities: ["read", "write"],
  sourceMode: "portal",
  visibility: "public",
  registrationPolicy: "public",
  inviteLimitAttendee: 5,
  settings: { forms: { proposal_submission: "existing-form" } },
  sessionTypes: [{ label: "Talk", durationMinutes: 30, requiresPresentation: true }],
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  vi.mocked(confirmAction).mockReset();
});
it("opens session type settings read-only and saves only that section", async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response("refused", { status: 409 }));
  vi.stubGlobal("fetch", fetcher);
  document.body.append(host);
  await act(() => render(<GeneralTab event={event} onUpdated={() => {}} section="session-types" />, host));
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("Presentation required");
  expect(host.textContent).not.toContain("Invite limit per attendee");
  await beginRecordEdit(host, "Event settings actions");
  expect(host.querySelector('input[type="checkbox"]')).not.toBeNull();
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const request = eventSettingsUpdateSchema.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)));
  expect(request).toEqual({ expectedUpdatedAt: event.updatedAt, sessionTypes: event.sessionTypes });
});

it("uses exact group authority and the group settings endpoint for portal session type edits", async () => {
  const groupId = "20000000-0000-4000-8000-000000000001";
  const onSaved = vi.fn();
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          event: {
            ...event,
            ownerGroupId: groupId,
            capabilities: ["view", "manage"],
            meetingLocation: null,
            nextOccurrenceAt: null,
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  document.body.append(host);
  const context = { groupId, eventId: event.id, canEdit: false, onSaved };
  await act(() =>
    render(
      <GeneralTab
        event={{ ...event, capabilities: ["read"] }}
        onUpdated={() => {}}
        section="session-types"
        groupSettings={context}
      />,
      host,
    ),
  );
  expect(host.querySelector('button[aria-label="Event settings actions"]')).toBeNull();
  await act(() =>
    render(
      <GeneralTab
        event={{ ...event, capabilities: ["read"] }}
        onUpdated={() => {}}
        section="session-types"
        groupSettings={{ ...context, canEdit: true }}
      />,
      host,
    ),
  );
  await beginRecordEdit(host, "Event settings actions");
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/groups/${groupId}/events/${event.id}/settings`);
  expect(groupEventSettingsUpdateSchema.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)))).toEqual({
    expectedUpdatedAt: event.updatedAt,
    sessionTypes: event.sessionTypes,
  });
  expect(onSaved).toHaveBeenCalledOnce();
});

const groupId = "20000000-0000-4000-8000-000000000001";
function groupResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      event: groupEventSchema.parse({
        ...event,
        ownerGroupId: groupId,
        capabilities: ["view", "manage"],
        meetingLocation: null,
        nextOccurrenceAt: null,
        ...overrides,
      }),
    }),
    { headers: { "content-type": "application/json" } },
  );
}
async function submit() {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
it("allows an authorized group manager to edit website location without direct write authority", async () => {
  const onSaved = vi.fn();
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => groupResponse());
  vi.stubGlobal("fetch", fetcher);
  document.body.append(host);
  await act(() =>
    render(
      <GeneralTab
        event={{ ...event, sourceMode: "hugo", capabilities: ["read"] }}
        section="location"
        onUpdated={() => {}}
        groupSettings={{ groupId, eventId: event.id, canEdit: true, onSaved }}
      />,
      host,
    ),
  );
  expect(host.querySelector("form")).toBeNull();
  await beginRecordEdit(host, "Event settings actions");
  await typeInto(controlFor(host, "Timezone"), "Europe/Amsterdam");
  await typeInto(controlFor(host, "Venue"), "Conference hall");
  expect(host.textContent).not.toContain("Virtual room");
  await submit();
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/groups/${groupId}/events/${event.id}/settings`);
  const body = groupEventSettingsUpdateSchema.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)));
  expect(body.timezone).toBe("Europe/Amsterdam");
  expect(body.venue).toBe("Conference hall");
  expect(body).not.toHaveProperty("name");
  expect(body).not.toHaveProperty("virtualUrl");
  expect(onSaved).toHaveBeenCalledOnce();
});
it("requires confirmation before a group manager changes the event address", async () => {
  const onSaved = vi.fn();
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => groupResponse({ slug: "renamed-event" }));
  vi.stubGlobal("fetch", fetcher);
  vi.mocked(confirmAction).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  document.body.append(host);
  await act(() =>
    render(
      <GeneralTab
        event={{ ...event, sourceMode: "hugo", capabilities: ["read"] }}
        onUpdated={() => {}}
        groupSettings={{ groupId, eventId: event.id, canEdit: true, onSaved }}
      />,
      host,
    ),
  );
  await beginRecordEdit(host, "Event settings actions");
  await typeInto(controlFor(host, "Slug"), "renamed-event");
  await submit();
  expect(fetcher).not.toHaveBeenCalled();
  expect(confirmAction).toHaveBeenCalledWith(
    expect.objectContaining({
      confirmLabel: "Change address",
      consequences: expect.arrayContaining([
        expect.stringContaining("Links using the old event address will stop working"),
      ]),
    }),
  );
  await submit();
  const body = groupEventSettingsUpdateSchema.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)));
  expect(body.slug).toBe("renamed-event");
  expect(body.confirmSlugChange).toBe(true);
  expect(onSaved).toHaveBeenCalledWith("renamed-event");
});

it("compares session types in a semantic table with only required presentations marked", async () => {
  document.body.append(host);
  await act(() =>
    render(
      <GeneralTab
        event={{
          ...event,
          sessionTypes: [
            { label: "talk", name: "Technical presentation", durationMinutes: 30, requiresPresentation: true },
            { label: "panel", name: "Panel discussion", requiresPresentation: false },
          ],
        }}
        onUpdated={() => {}}
        section="session-types"
      />,
      host,
    ),
  );
  const table = host.querySelector("table")!;
  expect(Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent?.trim())).toEqual([
    "Name",
    "Minutes",
    "Presentation required",
  ]);
  const rows = table.querySelectorAll("tbody tr");
  expect(rows[0]?.querySelectorAll("td")[0]?.querySelector(".pk-table__value")?.textContent).toBe(
    "Technical presentation",
  );
  expect(rows[0]?.querySelectorAll("td")[1]?.querySelector(".pk-table__value")?.textContent).toBe("30");
  expect(rows[0]?.querySelector('[role="img"][aria-label="Required"]')).not.toBeNull();
  expect(rows[1]?.querySelectorAll("td")[1]?.querySelector(".pk-table__value")?.textContent).toBe("");
  expect(rows[1]?.querySelectorAll("td")[2]?.querySelector(".pk-sr-only")?.textContent).toBe("Not required");
  expect(rows[1]?.querySelector('[role="img"]')).toBeNull();
});
it("changes a session type display name without changing its stable identifier", async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => groupResponse());
  vi.stubGlobal("fetch", fetcher);
  document.body.append(host);
  await act(() =>
    render(
      <GeneralTab
        event={{ ...event, capabilities: ["read"] }}
        section="session-types"
        onUpdated={() => {}}
        groupSettings={{ groupId, eventId: event.id, canEdit: true, onSaved: vi.fn() }}
      />,
      host,
    ),
  );
  await beginRecordEdit(host, "Event settings actions");
  expect(controlFor<HTMLInputElement>(host, "Identifier 1").readOnly).toBe(true);
  await typeInto(controlFor(host, "Name"), "Technical presentation");
  await submit();
  const body = groupEventSettingsUpdateSchema.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)));
  expect(body.sessionTypes?.[0]).toEqual({ ...event.sessionTypes![0], name: "Technical presentation" });
});

it("creates a session type from its display name with a stable generated identifier", async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => groupResponse());
  vi.stubGlobal("fetch", fetcher);
  document.body.append(host);
  await act(() =>
    render(
      <GeneralTab
        event={{ ...event, capabilities: ["read"], sessionTypes: [] }}
        section="session-types"
        onUpdated={() => {}}
        groupSettings={{ groupId, eventId: event.id, canEdit: true, onSaved: vi.fn() }}
      />,
      host,
    ),
  );
  await beginRecordEdit(host, "Event settings actions");
  const add = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Add session type"));
  await act(() => add!.click());
  await typeInto(controlFor(host, "Name"), "Expert Panel");
  expect(controlFor<HTMLInputElement>(host, "Identifier 1").value).toBe("expert-panel");
  expect(controlFor<HTMLInputElement>(host, "Identifier 1").readOnly).toBe(false);
  await submit();
  const body = groupEventSettingsUpdateSchema.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)));
  expect(body.sessionTypes).toEqual([{ name: "Expert Panel", label: "expert-panel", requiresPresentation: true }]);
});
