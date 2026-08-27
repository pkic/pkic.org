import { createAdminSession } from "./auth";
import { insertUser } from "./membership";
import { createGroup } from "../../functions/_lib/services/groups";
import { createGroupManagedEvent } from "../../functions/_lib/services/events/group-management";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../functions/_lib/types";

export type GroupEventInvitationFixture = {
  actor: UserBackedAuthAdmin;
  groupId: string;
  eventId: string;
  eventSlug: string;
  token: string;
  basePath: string;
};

export async function createGroupEventInvitationFixture(
  db: DatabaseLike,
  label: string,
  overrides: Partial<{
    startsAt: string;
    endsAt: string;
    inviteLimitAttendee: number;
  }> = {},
): Promise<GroupEventInvitationFixture> {
  const suffix = crypto.randomUUID();
  const email = `${label}-${suffix}@example.test`;
  const userId = await insertUser(db, email);
  await db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(userId).run();
  const actor: UserBackedAuthAdmin = { identityType: "user", id: userId, email, role: "admin" };
  const group = await createGroup(db, actor, {
    typeKey: "working_group",
    name: `${label} ${suffix}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const eventSlug = `${label}-${suffix}`;
  const event = await createGroupManagedEvent(db, actor, group.id, {
    name: `${label} event`,
    slug: eventSlug,
    timezone: "UTC",
    startsAt: overrides.startsAt ?? "2027-04-01T09:00:00.000Z",
    endsAt: overrides.endsAt ?? "2027-04-01T17:00:00.000Z",
    profileKey: "workshop",
    registrationPolicy: "no_registration",
    inviteLimitAttendee: overrides.inviteLimitAttendee ?? 5,
    location: "Online",
    links: [],
  });
  const token = await createAdminSession(db, actor.id, `${label}-session-${suffix}`);
  return {
    actor,
    groupId: group.id,
    eventId: event.eventId,
    eventSlug,
    token,
    basePath: `/api/v1/groups/${group.id}/events/${event.eventId}/invites`,
  };
}
