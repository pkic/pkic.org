import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
import { addHours, nowIso } from "../../../../_lib/utils/time";
import {
  clearInviteRemindersPause,
  declineInvite,
  findInviteByToken,
  setInviteRemindersPausedUntil,
} from "../../../../_lib/services/invites";
import type { PagesContext } from "../../../../_lib/types";
import { inviteReminderPreferenceSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  const body = await parseJsonBody(context.request, inviteReminderPreferenceSchema);
  const invite = await findInviteByToken(context.env.DB, context.params.token);

  if (body.action === "unsubscribe") {
    await declineInvite(context.env.DB, {
      inviteId: invite.id,
      reasonCode: "not_interested",
      unsubscribeFuture: true,
    });
    return json({ success: true, state: "unsubscribed" });
  }

  if (body.action === "resume") {
    await clearInviteRemindersPause(context.env.DB, invite.id);
    return json({ success: true, state: "active", pausedUntil: null });
  }

  const now = nowIso();
  const pausedUntil = body.action === "postpone_7d"
    ? addHours(now, 24 * 7)
    : addHours(now, 24 * 30);

  await setInviteRemindersPausedUntil(context.env.DB, invite.id, pausedUntil);

  return json({
    success: true,
    state: body.action === "postpone_7d" ? "postponed" : "paused",
    pausedUntil,
  });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
