/**
 * Speaker self-management endpoint (token-authenticated).
 *
 * GET  /api/v1/proposals/speaker/[token]
 *   Returns the speaker's participation status, proposal details, and profile.
 *
 * POST /api/v1/proposals/speaker/[token]
 *   Body: { action: "confirm", termsAccepted: true }   — confirm participation
 *         { action: "decline", reason?: string }        — decline participation
 *
 * PATCH /api/v1/proposals/speaker/[token]
 *   Body: { biography?: string, links?: object[] }      — update speaker profile (bio / links)
 *
 * For headshot and presentation file uploads see:
 *   PUT /api/v1/proposals/speaker/[token]/headshot
 *   PUT /api/v1/proposals/speaker/[token]/presentation
 */
import { json, markSensitive } from "../../../../_lib/http";
import {
  getSpeakerByManageToken,
  confirmSpeakerParticipation,
  declineSpeakerParticipation,
  updateSpeakerProfile,
} from "../../../../_lib/services/proposals";
import { getRequiredTerms } from "../../../../_lib/services/events";
import { persistConsents, validateRequiredConsents } from "../../../../_lib/services/consent";
import { parseJsonBody } from "../../../../_lib/validation";
import { requireInternalSecret } from "../../../../_lib/request";
import type { PagesContext } from "../../../../_lib/types";
import { z } from "zod";

const speakerActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    consents: z.array(z.object({
      termKey: z.string().trim().min(1).max(128),
      version: z.string().trim().min(1).max(64),
    })).min(1).max(20),
  }),
  z.object({
    action: z.literal("decline"),
    reason: z.string().trim().max(2000).optional(),
  }),
]);

const speakerProfileSchema = z.object({
  biography: z.string().trim().min(1).max(10_000).optional(),
  links: z
    .array(
      z.object({
        label: z.string().trim().max(128),
        url: z.string().url().max(2048),
      }),
    )
    .max(10)
    .optional(),
});

export async function onRequestGet(context: PagesContext<{ token: string }>): Promise<Response> {
  const { speaker, proposal, user } = await getSpeakerByManageToken(
    context.env.DB,
    context.params.token,
  );

  return json({
    speaker: {
      role: speaker.role,
      status: speaker.status,
      confirmedAt: speaker.confirmed_at,
      declinedAt: speaker.declined_at,
      termsAcceptedAt: speaker.terms_accepted_at,
    },
    proposal: {
      id: proposal.id,
      title: proposal.title,
      proposalType: proposal.proposal_type,
      status: proposal.status,
      presentationDeadline: proposal.presentation_deadline ?? null,
      presentationUploaded: Boolean(proposal.presentation_uploaded_at),
    },
    profile: {
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      organizationName: user.organization_name,
      jobTitle: user.job_title,
      biography: user.biography,
      links: user.links_json ? JSON.parse(user.links_json) : [],
      headshotUploaded: Boolean(user.headshot_r2_key),
      headshotUpdatedAt: user.headshot_updated_at,
      headshotUrl: user.headshot_r2_key
        ? `${new URL(context.request.url).origin}/api/v1/proposals/speaker/${encodeURIComponent(context.params.token)}/headshot?v=${encodeURIComponent(user.headshot_updated_at ?? "")}`
        : null,
    },
  });
}

export async function onRequestPost(context: PagesContext<{ token: string }>): Promise<Response> {
  const body = await parseJsonBody(context.request, speakerActionSchema);

  if (body.action === "confirm") {
    const info = await getSpeakerByManageToken(context.env.DB, context.params.token);

    // Already confirmed is treated as success and does not require resubmission.
    if (info.speaker.status !== "confirmed") {
      const requiredTerms = await getRequiredTerms(context.env.DB, info.proposal.event_id, "speaker");
      await validateRequiredConsents(requiredTerms, body.consents);

      const signingSecret = requireInternalSecret(context.env);
      await persistConsents(context.env.DB, {
        proposalId: info.proposal.id,
        eventId: info.proposal.event_id,
        userId: info.speaker.user_id,
        audienceType: "speaker",
        accepted: body.consents,
        ip: context.request.headers.get("cf-connecting-ip"),
        userAgent: context.request.headers.get("user-agent"),
        secret: signingSecret,
      });
    }

    await confirmSpeakerParticipation(context.env.DB, context.params.token, {
      termsAccepted: true,
    });
    return json({ success: true, status: "confirmed" });
  }

  await declineSpeakerParticipation(context.env.DB, context.params.token, {
    reason: body.reason ?? null,
  });
  return json({ success: true, status: "declined" });
}

export async function onRequestPatch(context: PagesContext<{ token: string }>): Promise<Response> {
  const body = await parseJsonBody(context.request, speakerProfileSchema);
  const { speaker, user } = await getSpeakerByManageToken(context.env.DB, context.params.token);

  if (speaker.status === "declined") {
    return json(
      { error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } },
      403,
    );
  }

  await updateSpeakerProfile(context.env.DB, user.id, {
    biography: body.biography ?? null,
    linksJson: body.links ? JSON.stringify(body.links) : null,
  });

  return json({ success: true });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);

  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
