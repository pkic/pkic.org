import { parseJsonBody } from "../../../../../_lib/validation";
import { json, markSensitive } from "../../../../../_lib/http";
import { addHours, nowIso } from "../../../../../_lib/utils/time";
import { getSpeakerByManageToken } from "../../../../../_lib/services/proposals";
import { run } from "../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../_lib/types";
import { speakerReminderPreferenceSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  const body = await parseJsonBody(context.request, speakerReminderPreferenceSchema);
  const resolved = await getSpeakerByManageToken(context.env.DB, context.params.token);

  if (body.action === "resume") {
    await run(
      context.env.DB,
      "UPDATE proposal_speakers SET presentation_reminders_paused_until = NULL WHERE id = ?",
      [resolved.speaker.id],
    );
    return json({ success: true, state: "active", pausedUntil: null });
  }

  const now = nowIso();
  const pausedUntil = body.action === "postpone_7d"
    ? addHours(now, 24 * 7)
    : addHours(now, 24 * 30);

  await run(
    context.env.DB,
    "UPDATE proposal_speakers SET presentation_reminders_paused_until = ? WHERE id = ?",
    [pausedUntil, resolved.speaker.id],
  );

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
