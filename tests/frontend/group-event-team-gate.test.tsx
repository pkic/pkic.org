// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailSchema } from "../../assets/shared/schemas/event-management";
import { groupEventSchema } from "../../assets/shared/schemas/group-events";
import { GroupEventSettingsTab } from "../../assets/ts/member-flows/portal/sections/management/GroupEventSettingsTab";

const granted = vi.hoisted(() => ({ permissions: new Set<string>() }));
const teamProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/event-agenda-access", () => ({
  hasEventAgendaPermission: (_event: string, permission: string) => granted.permissions.has(permission),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/settings/EventTeamSettings", () => ({
  EventTeamSettings: (props: Record<string, unknown>) => {
    teamProps.last = props;
    return null;
  },
}));

const groupId = "20000000-0000-4000-8000-000000000001";
const event = groupEventSchema.parse({
  ...eventDetailSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    city: null,
    country: null,
    startsAt: null,
    endsAt: null,
    profileKey: "conference",
    basePath: null,
    userRetentionDays: null,
    venue: null,
    virtualUrl: null,
    heroImageUrl: null,
    ownerGroupId: groupId,
    seriesId: null,
    links: [],
    registrationPath: null,
    slug: "synthetic",
    name: "Synthetic",
    timezone: "UTC",
    updatedAt: "2026-10-12T00:00:00.000Z",
    capabilities: ["read"],
    sourceMode: "portal",
    visibility: "public",
    registrationPolicy: "public",
    inviteLimitAttendee: 5,
    settings: {},
    sessionTypes: [],
  }),
  // An event Organizer views the owning group's event without managing the group.
  capabilities: ["view"],
  meetingLocation: null,
  nextOccurrenceAt: null,
});

const host = document.createElement("div");
document.body.append(host);
afterEach(async () => {
  await act(() => render(null, host));
  granted.permissions.clear();
  teamProps.last = null;
});

async function mountTeam() {
  await act(async () => {
    render(<GroupEventSettingsTab event={event} groupId={groupId} settingsPath="/settings" detailId="team" />, host);
  });
  await vi.waitFor(() => expect(teamProps.last).not.toBeNull());
}

it("lets an event Organizer grant team roles without managing the owning group", async () => {
  granted.permissions = new Set(["events:manage", "agenda:read", "agenda:write"]);
  await mountTeam();
  expect(teamProps.last?.canManage).toBe(true);
});

it("keeps role granting from a reader who only sees scheduling duties", async () => {
  granted.permissions = new Set(["agenda:read", "agenda:live_studio"]);
  await mountTeam();
  expect(teamProps.last?.canManage).toBe(false);
  expect(teamProps.last?.canReadStaffing).toBe(true);
});
