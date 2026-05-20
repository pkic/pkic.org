import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { bulkCreateAttendeesAdmin } from "../../../../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { bulkQueueInviteEmails } from "../../../../../../../_lib/email/outbox";
import { registrationPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import {
  computeAttendeeInviteDigest,
  verifyAttendeeInvitePreviewToken,
} from "../../../../../../../_lib/services/admin-invite-preview";
import { adminBulkAttendeeInvitesSchema } from "../../../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

// Outcome buckets returned to the admin UI.
type BulkItemResult = { email: string; inviteToken?: string };

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminBulkAttendeeInvitesSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const secret = requireInternalSecret(c.env);

  // When sending a large list in chunks the frontend supplies the digest of the
  // full invite list (matching what was committed at preview time).  For single-
  // batch sends the digest is computed directly from the current invites.
  const inviteDigest = body.inviteDigest ?? (await computeAttendeeInviteDigest(body.invites));
  const previewValidation = await verifyAttendeeInvitePreviewToken({
    secret,
    token: body.previewToken,
    eventId: event.id,
    adminId: admin.id,
    inviteDigest,
  });

  if (!previewValidation.ok) {
    if (previewValidation.reason === "expired") {
      throw new AppError(
        409,
        "INVITE_PREVIEW_EXPIRED",
        "Invite preview expired. Render a fresh preview before sending.",
      );
    }
    if (previewValidation.reason === "mismatch") {
      throw new AppError(
        409,
        "INVITE_PREVIEW_STALE",
        "Invite list changed after preview. Render preview again before sending.",
      );
    }
    throw new AppError(400, "INVITE_PREVIEW_INVALID", "Invalid invite preview token. Render preview before sending.");
  }

  // Bulk-create invites: 3 D1 round-trips total (pre-check batch + token hashing + insert batch)
  // instead of N×4-6 sequential round-trips for N invites.
  const outcomes = await bulkCreateAttendeesAdmin(requestDb(c), {
    event,
    invites: body.invites.map((i) => ({
      inviteeEmail: i.email,
      inviteeFirstName: i.firstName ?? null,
      inviteeLastName: i.lastName ?? null,
      sourceType: i.sourceType,
    })),
  });

  // Pre-compute shared email variables once.
  const sharedEmailVars = buildEventEmailVariables(event, appBaseUrl);

  // Queue invite emails for new invites in a single batch INSERT.
  const emailRows = outcomes
    .filter((o) => o.status === "created" && o.token)
    .map((o) => ({
      eventId: event.id,
      recipientEmail: o.email,
      templateKey: "attendee_invite",
      subject: `Invitation: ${event.name}`,
      data: {
        ...sharedEmailVars,
        registrationUrl: registrationPageUrl(appBaseUrl, event, { invite: o.token!, source: "invite" }),
        declineUrl: inviteDeclineUrl(appBaseUrl, event, o.token!),
      },
    }));
  await bulkQueueInviteEmails(requestDb(c), emailRows);

  const created: BulkItemResult[] = outcomes
    .filter((o) => o.status === "created")
    .map((o) => ({ email: o.email, inviteToken: o.token }));
  const endorsed: BulkItemResult[] = outcomes.filter((o) => o.status === "endorsed").map((o) => ({ email: o.email }));
  const skipped: BulkItemResult[] = outcomes.filter((o) => o.status === "skipped").map((o) => ({ email: o.email }));

  return json({ success: true, created, endorsed, skipped });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
