import { json, markSensitive } from "../../../../_lib/http";
import { sha256Hex } from "../../../../_lib/utils/crypto";
import { first } from "../../../../_lib/db/queries";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { isPast } from "../../../../_lib/utils/time";
import { proposalPageUrl, registrationPageUrl } from "../../../../_lib/services/frontend-links";
import type { PagesContext } from "../../../../_lib/types";

interface InviteRow {
  id: string;
  event_id: string;
  invitee_first_name: string | null;
  invite_type: "attendee" | "speaker";
  status: string;
  expires_at: string | null;
}

interface EventRow {
  id: string;
  name: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

/**
 * GET /api/v1/invites/:token/decline-info
 *
 * Returns JSON describing the invite state so the Hugo decline page can render
 * the correct UI without ever serving raw HTML from the backend.
 */
export async function onRequestGet(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);

  const tokenHash = await sha256Hex(context.params.token);
  const invite = await first<InviteRow>(
    context.env.DB,
    "SELECT id, event_id, invitee_first_name, invite_type, status, expires_at FROM invites WHERE token_hash = ?",
    [tokenHash],
  );

  if (!invite) {
    return json({ status: "invalid" });
  }

  if (invite.status === "declined" || invite.status === "accepted") {
    return json({ status: "already_processed" });
  }

  if (invite.status === "expired" || invite.status === "revoked") {
    return json({ status: "expired" });
  }

  // status === 'sent' — check expiry
  if (invite.expires_at && isPast(invite.expires_at)) {
    return json({ status: "expired" });
  }

  // Valid invite — fetch event details to build the registration URL
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const event = await first<EventRow>(
    context.env.DB,
    "SELECT id, name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?",
    [invite.event_id],
  );

  const registrationUrl = event && invite.invite_type === "attendee"
    ? registrationPageUrl(appBaseUrl, event, { source: "decline-virtual-pivot" })
    : null;
  const proposalUrl = event && invite.invite_type === "speaker"
    ? proposalPageUrl(appBaseUrl, event, { source: "speaker_invite_decline_reconsider" })
    : null;

  return json({
    status: "valid",
    eventName: event?.name ?? null,
    inviteeFirstName: invite.invitee_first_name ?? null,
    inviteType: invite.invite_type,
    registrationUrl,
    proposalUrl,
  });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
