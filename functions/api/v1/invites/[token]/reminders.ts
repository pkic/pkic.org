import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
import { addHours, nowIso } from "../../../../_lib/utils/time";
import {
  clearInviteRemindersPause,
  declineInvite,
  findInviteByToken,
  setInviteRemindersPausedUntil,
} from "../../../../_lib/services/invites";
import { inviteReminderPreferenceSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);
  const body = await parseJsonBody(c.req, inviteReminderPreferenceSchema);
  const invite = await findInviteByToken(c.env.DB, c.req.param("token"));

  if (body.action === "unsubscribe") {
    await declineInvite(c.env.DB, {
      inviteId: invite.id,
      reasonCode: "not_interested",
      unsubscribeFuture: true,
    });
    return json({ success: true, state: "unsubscribed" });
  }

  if (body.action === "resume") {
    await clearInviteRemindersPause(c.env.DB, invite.id);
    return json({ success: true, state: "active", pausedUntil: null });
  }

  const now = nowIso();
  const pausedUntil = body.action === "postpone_7d"
    ? addHours(now, 24 * 7)
    : addHours(now, 24 * 30);

  await setInviteRemindersPausedUntil(c.env.DB, invite.id, pausedUntil);

  return json({
    success: true,
    state: body.action === "postpone_7d" ? "postponed" : "paused",
    pausedUntil,
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
