import type { z } from "zod";
import type {
  inviteReminderPreferenceResponseSchema,
  inviteReminderPreferenceSchema,
} from "../../../assets/shared/schemas/invites";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { addHours, nowIso } from "../utils/time";
import { declineInvite, isStaleInviteTransition } from "./invite-lifecycle";
import { prepareInviteRemindersPausedUntil } from "./invite-reminder-state";
import type { InviteRecord } from "./invite-types";

export type InviteReminderAction = z.infer<typeof inviteReminderPreferenceSchema>["action"];
type InviteReminderPreferenceResult = Omit<z.infer<typeof inviteReminderPreferenceResponseSchema>, "success">;

const PAUSE_HOURS = { postpone_7d: 24 * 7, pause_30d: 24 * 30 } as const;

/**
 * What each reminder preference does to an invitation. The emailed link and
 * the signed-in invitee apply the same rule; `guards` carries the caller's
 * authorization so it is rechecked in the same batch as the change.
 */
export async function updateInviteReminderPreference(
  db: DatabaseLike,
  invite: Pick<InviteRecord, "id">,
  action: InviteReminderAction,
  guards: StatementLike[] = [],
): Promise<InviteReminderPreferenceResult> {
  if (action === "unsubscribe") {
    await declineInvite(db, { inviteId: invite.id, reasonCode: "not_interested", unsubscribeFuture: true }, guards);
    return { state: "unsubscribed" };
  }
  const pausedUntil = action === "resume" ? null : addHours(nowIso(), PAUSE_HOURS[action]);
  try {
    await db.batch([...guards, prepareInviteRemindersPausedUntil(db, invite.id, pausedUntil)]);
  } catch (error) {
    if (!isStaleInviteTransition(error) && !isAuthorizationGuardFailure(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed; please retry");
  }
  if (action === "resume") return { state: "active", pausedUntil: null };
  return { state: action === "postpone_7d" ? "postponed" : "paused", pausedUntil };
}
