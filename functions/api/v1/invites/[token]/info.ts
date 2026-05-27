import { json } from "../../../../_lib/http";
import { sha256Hex } from "../../../../_lib/utils/crypto";
import { first } from "../../../../_lib/db/queries";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { getInviteInviters } from "../../../../_lib/services/invites";
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
 * GET /api/v1/invites/:token/info
 *
 * Returns invite metadata together with the full list of inviters so the
 * registration / proposal landing page can display social-proof copy such as:
 *
 *   "You have been personally invited by Paul van Brouwershaven, Sven Rajala,
 *    Chris Bailey and 4 others."
 *
 * Only first/last names are returned – no email addresses or internal IDs.
 */
export async function onRequestGet(c: any): Promise<Response> {
  c.set("sensitive", true);

  const tokenHash = await sha256Hex(c.req.param("token"));
  const inviteId = new URL(c.req.raw.url).searchParams.get("id");
  const invite = await first<InviteRow>(
    c.env.DB,
    "SELECT id, event_id, invitee_first_name, invite_type, status, expires_at FROM invites WHERE token_hash = ? AND (? IS NULL OR id = ?)",
    [tokenHash, inviteId, inviteId],
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

  // Valid invite — build URLs and social-proof inviter list.
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const event = await first<EventRow>(
    c.env.DB,
    "SELECT id, name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?",
    [invite.event_id],
  );

  const registrationUrl =
    event && invite.invite_type === "attendee"
      ? registrationPageUrl(appBaseUrl, event, { invite: c.req.param("token"), inviteId: invite.id, source: "invite" })
      : null;
  const proposalUrl =
    event && invite.invite_type === "speaker"
      ? proposalPageUrl(appBaseUrl, event, {
          invite: c.req.param("token"),
          inviteId: invite.id,
          source: "speaker_invite",
        })
      : null;

  // Fetch all named inviters for social proof.  Only expose first/last name.
  const allInviters = await getInviteInviters(c.env.DB, invite.id);
  const totalInviters = allInviters.length;

  // Return at most 5 names to keep the payload small; the frontend can say
  // "…and N others" using totalInviters.
  const inviters = allInviters.slice(0, 5).map((i) => ({
    firstName: i.firstName,
    lastName: i.lastName,
    organizationName: i.organizationName,
  }));

  return json({
    status: "valid",
    eventName: event?.name ?? null,
    inviteeFirstName: invite.invitee_first_name ?? null,
    inviteType: invite.invite_type,
    registrationUrl,
    proposalUrl,
    inviters,
    totalInviters,
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
