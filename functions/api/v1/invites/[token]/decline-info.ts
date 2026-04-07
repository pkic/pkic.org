import { json } from "../../../../_lib/http";
import { sha256Hex } from "../../../../_lib/utils/crypto";
import { first } from "../../../../_lib/db/queries";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { isPast } from "../../../../_lib/utils/time";
import { proposalPageUrl, registrationPageUrl } from "../../../../_lib/services/frontend-links";

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
export async function onRequestGet(c: any): Promise<Response> {
  c.set("sensitive", true);

  const tokenHash = await sha256Hex(c.req.param("token"));
  const invite = await first<InviteRow>(
    c.env.DB,
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
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const event = await first<EventRow>(
    c.env.DB,
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

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
