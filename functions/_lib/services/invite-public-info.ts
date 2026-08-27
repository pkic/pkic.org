import { first } from "../db/queries";
import { verifyDatabaseCapability } from "./capability-links";
import { getEventById, type EventRecord } from "./events";
import type { DatabaseLike } from "../types";
import { isPast } from "../utils/time";
import { effectiveStoredInviteExpiry } from "../invite-validity";

export interface PublicInviteRecord {
  id: string;
  event_id: string;
  invitee_first_name: string | null;
  invite_type: "attendee" | "speaker";
  status: string;
  expires_at: string | null;
}

export type ResolvedPublicInvite =
  | { status: "already_processed" | "expired" | "invalid" }
  | { status: "valid"; invite: PublicInviteRecord; event: EventRecord };

export type PublicInviteView =
  | Exclude<ResolvedPublicInvite, { status: "valid" }>
  | {
      status: "valid";
      invite: PublicInviteRecord;
      event: EventRecord;
      summary: {
        status: "valid";
        eventName: string;
        inviteeFirstName: string | null;
        inviteType: PublicInviteRecord["invite_type"];
      };
    };

/** Shared capability and lifecycle resolution for every public invite-info view. */
export async function resolvePublicInvite(
  db: DatabaseLike,
  signingSecret: string,
  token: string,
  inviteId?: string,
): Promise<ResolvedPublicInvite> {
  const verified = await verifyDatabaseCapability({
    db,
    signingSecret,
    purpose: "invite",
    token,
    allowInactiveInvite: true,
  });
  if (!verified.ok) return { status: verified.reason === "expired" ? "expired" : "invalid" };

  const invite = await first<PublicInviteRecord>(
    db,
    `SELECT id, event_id, invitee_first_name, invite_type, status, expires_at
     FROM invites
     WHERE id = ? AND (? IS NULL OR id = ?)
     LIMIT 1`,
    [verified.resourceId, inviteId ?? null, inviteId ?? null],
  );
  if (!invite) return { status: "invalid" };
  const event = await getEventById(db, invite.event_id);
  const effectiveExpiry = effectiveStoredInviteExpiry(event, invite.expires_at);
  if (effectiveExpiry === null || isPast(effectiveExpiry)) return { status: "expired" };
  if (invite.status === "declined" || invite.status === "accepted") return { status: "already_processed" };
  if (invite.status === "expired" || invite.status === "revoked") return { status: "expired" };
  return { status: "valid", invite, event };
}

export async function resolvePublicInviteView(
  db: DatabaseLike,
  signingSecret: string,
  token: string,
  inviteId?: string,
): Promise<PublicInviteView> {
  const resolved = await resolvePublicInvite(db, signingSecret, token, inviteId);
  if (resolved.status !== "valid") return resolved;
  return {
    ...resolved,
    summary: {
      status: "valid",
      eventName: resolved.event.name,
      inviteeFirstName: resolved.invite.invitee_first_name ?? null,
      inviteType: resolved.invite.invite_type,
    },
  };
}
