/**
 * Where an event row leads, and who may be offered the owning group's
 * workspace.
 *
 * Every row opens the group-independent event page; the workspace is offered
 * only to a session that can actually open that group, so an event-scoped
 * staff identity is never sent into a refusal.
 */
import { describe, expect, it } from "vitest";
import { eventAudienceDetailSchema, eventManagementSummarySchema } from "../../assets/shared/schemas/event-management";
import {
  canOpenGroupWorkspace,
  eventDestination,
} from "../../assets/ts/member-flows/portal/sections/events/event-destination";
import { portalSessionFixture } from "../helpers/portal-session";

const GROUP_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_ID = "10000000-0000-4000-8000-000000000001";

const core = {
  id: EVENT_ID,
  slug: "pqc 2026",
  name: "PQC Conference 2026",
  timezone: "UTC",
  startsAt: null,
  endsAt: null,
  profileKey: null,
  registrationPolicy: "public",
  visibility: "public",
};

describe("eventDestination", () => {
  it("opens the event page for a group-owned management row, not the group workspace", () => {
    const row = eventManagementSummarySchema.parse({
      ...core,
      sourceMode: null,
      inviteLimitAttendee: 5,
      updatedAt: "2026-08-01T00:00:00.000Z",
      ownerGroupId: GROUP_ID,
      ownerGroupName: "Post-Quantum Cryptography",
      sourcePath: null,
      basePath: null,
      totalRegistrations: 0,
      confirmedRegistrations: 0,
      pendingInvites: 0,
    });
    expect(eventDestination(row)).toBe("#/events/pqc%202026");
  });

  it("opens the same event page for an audience row with scanner access only", () => {
    const row = eventAudienceDetailSchema.parse({
      ...core,
      accessLevel: "participant",
      location: null,
      links: [],
      basePath: null,
      sponsorLeadAccess: false,
      viewer: null,
      scannerAccess: { canScan: true, sponsors: [{ id: "s1", name: "Sponsor" }] },
    });
    expect(eventDestination(row)).toBe("#/events/pqc%202026");
  });
});

describe("canOpenGroupWorkspace", () => {
  it.each([
    { label: "no session", session: null, expected: false },
    { label: "a member", session: portalSessionFixture({ member: true }), expected: true },
    { label: "an administrator", session: portalSessionFixture({ staff: true }), expected: true },
    {
      label: "a global groups reader",
      session: portalSessionFixture({
        staff: true,
        grants: [{ permission: "groups:read", contextType: null, contextId: null }],
      }),
      expected: true,
    },
    {
      label: "a grant on this exact group",
      session: portalSessionFixture({
        staff: true,
        grants: [{ permission: "events:manage", contextType: "group", contextId: GROUP_ID }],
      }),
      expected: true,
    },
    {
      label: "a grant on another group",
      session: portalSessionFixture({
        staff: true,
        grants: [{ permission: "events:manage", contextType: "group", contextId: "other-group" }],
      }),
      expected: false,
    },
    {
      label: "an event-scoped staff grant",
      session: portalSessionFixture({
        staff: true,
        grants: [{ permission: "events:manage", contextType: "event", contextId: EVENT_ID }],
      }),
      expected: false,
    },
    {
      label: "an event-scoped groups grant",
      session: portalSessionFixture({
        staff: true,
        grants: [{ permission: "groups:read", contextType: "event", contextId: EVENT_ID }],
      }),
      expected: false,
    },
  ])("answers $expected for $label", ({ session, expected }) => {
    expect(canOpenGroupWorkspace(session, GROUP_ID)).toBe(expected);
  });
});
