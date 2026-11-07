import { declineSpeakerParticipation } from "../../../../../../_lib/services/proposal-speaker-decline";
import { confirmSpeakerParticipation } from "../../../../../../_lib/services/proposal-speaker-confirmation";
import { processSelectedOutboxBackground } from "../../../../../../_lib/email/outbox";
import { speakerParticipationResponseSchema } from "../../../../../../../assets/shared/schemas/speaker-self-service";
import { proposalSpeakerParticipationRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { requestDb, markResponseSensitive, type AdminContext } from "../../../../../../_lib/db/context";
import type { ParticipantRouteData } from "../../../../../../_lib/routes/participant-authority";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { handleError, json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export async function onRequestParticipationPatch(
  c: AdminContext,
  data: ParticipantRouteData<typeof proposalSpeakerParticipationRouteSchema>,
): Promise<Response> {
  try {
    const body = data.body;
    const token = data.params.token;

    if (body.status === "confirmed") {
      const confirmed = await confirmSpeakerParticipation(requestDb(c), token, requireInternalSecret(c.env), {
        consents: body.consents,
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        ip: c.req.raw.headers.get("cf-connecting-ip"),
        userAgent: c.req.raw.headers.get("user-agent"),
      });
      if (confirmed.outboxIds.length)
        c.executionCtx.waitUntil(processSelectedOutboxBackground(requestDb(c), c.env, confirmed.outboxIds));
      return json(speakerParticipationResponseSchema.parse({ success: true, status: confirmed.status }));
    }

    const declined = await declineSpeakerParticipation(requestDb(c), token, requireInternalSecret(c.env), {
      reason: body.reason ?? null,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    });
    if (declined.outboxIds.length > 0)
      c.executionCtx.waitUntil(processSelectedOutboxBackground(requestDb(c), c.env, declined.outboxIds));
    return json(speakerParticipationResponseSchema.parse({ success: true, status: "declined" }));
  } catch (error) {
    return handleError(error);
  }
}

export const ProposalSpeakerAccessParticipationPatch = openApiRoute(
  proposalSpeakerParticipationRouteSchema,
  onRequestParticipationPatch,
  markResponseSensitive,
);
