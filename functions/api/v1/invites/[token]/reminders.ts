import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { addHours, nowIso } from "../../../../_lib/utils/time";
import {
  clearInviteRemindersPause,
  declineInvite,
  findInviteByToken,
  setInviteRemindersPausedUntil,
} from "../../../../_lib/services/invites";
import {
  inviteCapabilityQuerySchema,
  inviteReminderPreferenceRouteSchema,
  inviteReminderPreferenceSchema,
} from "../../../../../assets/shared/schemas/invites";
import { requireInternalSecret } from "../../../../_lib/request";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";

type ReminderAction = "postpone_7d" | "pause_30d" | "resume" | "unsubscribe";

async function updateInviteReminderPreference(
  c: AdminContext,
  token: string,
  inviteId: string | undefined,
  body: { action: ReminderAction },
): Promise<Response> {
  c.set?.("sensitive", true);
  const invite = await findInviteByToken(c.env.DB, token, requireInternalSecret(c.env), inviteId ?? null);

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
  const pausedUntil = body.action === "postpone_7d" ? addHours(now, 24 * 7) : addHours(now, 24 * 30);

  await setInviteRemindersPausedUntil(c.env.DB, invite.id, pausedUntil);

  return json({
    success: true,
    state: body.action === "postpone_7d" ? "postponed" : "paused",
    pausedUntil,
  });
}

export const InviteRemindersPost = openApiRoute(inviteReminderPreferenceRouteSchema, (c: AdminContext, data) =>
  updateInviteReminderPreference(c, data.params.token, data.query.id, data.body),
);

/** Compatibility export for direct endpoint tests. */
export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, inviteReminderPreferenceSchema);
  const query = inviteCapabilityQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return updateInviteReminderPreference(c, c.req.param("token"), query.id, body);
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
