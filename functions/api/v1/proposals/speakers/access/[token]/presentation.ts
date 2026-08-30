/**
 * Current proposal-speaker presentation resource.
 *
 * GET /api/v1/proposals/speakers/access/[token]/presentation downloads the current file.
 * PUT /api/v1/proposals/speakers/access/[token]/presentation uploads a new version.
 *   Content-Type: multipart/form-data
 *   Field: "file" — PDF or PowerPoint file (PPTX / ODP / PPTM accepted)
 *
 * The file is stored in the SPEAKER_UPLOADS_BUCKET R2 bucket under a
 * human-searchable event and proposal prefix.
 *
 * Each upload creates a new version in presentation_versions; the previous version is retained.
 * Speakers can re-upload until the deadline.
 */
import { json } from "../../../../../../_lib/http";
import { getSpeakerByManageToken } from "../../../../../../_lib/services/proposals";
import {
  getPresentationProposalContext,
  requirePresentationBucket,
  uploadProposalPresentation,
} from "../../../../../../_lib/services/presentation-upload";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { requestDb } from "../../../../../../_lib/db/context";
import {
  getCurrentPresentationVersion,
  presentationDownloadResponse,
} from "../../../../../../_lib/services/presentation-versions";
import {
  speakerPresentationUploadResponseSchema,
  speakerPresentationUploadRouteSchema,
  speakerPresentationDownloadRouteSchema,
} from "../../../../../../../assets/shared/schemas/speaker-self-service";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export async function onRequestGet(c: any, token: string): Promise<Response> {
  const { speaker, proposal } = await getSpeakerByManageToken(requestDb(c), token, requireInternalSecret(c.env));

  if (speaker.status !== "confirmed") {
    return json(
      {
        error: {
          code: speaker.status === "declined" ? "SPEAKER_DECLINED" : "SPEAKER_NOT_CONFIRMED",
          message:
            speaker.status === "declined"
              ? "You have declined participation."
              : "Please confirm participation before downloading.",
        },
      },
      403,
    );
  }
  if (proposal.status !== "accepted") {
    return json(
      { error: { code: "PROPOSAL_NOT_ACCEPTED", message: "Presentations are unavailable for this proposal." } },
      409,
    );
  }

  const version = await getCurrentPresentationVersion(requestDb(c), proposal.id);
  if (!version) return json({ error: { code: "NO_PRESENTATION", message: "No presentation uploaded yet" } }, 404);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) return json({ error: { message: "File storage not configured" } }, 503);
  const object = await bucket.get(version.r2Key);
  if (!object) return json({ error: { message: "File not found in storage" } }, 404);
  return presentationDownloadResponse(object, version);
}

export async function onRequestPut(c: any): Promise<Response> {
  const { speaker, proposal } = await getSpeakerByManageToken(
    requestDb(c),
    c.req.param("token"),
    requireInternalSecret(c.env),
  );

  if (speaker.status !== "confirmed") {
    return json(
      {
        error: {
          code: speaker.status === "declined" ? "SPEAKER_DECLINED" : "SPEAKER_NOT_CONFIRMED",
          message:
            speaker.status === "declined"
              ? "You have declined participation."
              : "Please confirm participation before uploading.",
        },
      },
      403,
    );
  }

  const uploadContext = await getPresentationProposalContext(requestDb(c), proposal.id);
  await uploadProposalPresentation(requestDb(c), requirePresentationBucket(c.env), c.req.raw, uploadContext, {
    actor: { type: "user", userId: speaker.user_id },
    enforceDeadline: true,
    authority: {
      speaker: {
        id: speaker.id,
        userId: speaker.user_id,
        role: speaker.role,
        status: speaker.status,
        inviteGeneration: speaker.invite_generation,
      },
    },
  });

  return json(speakerPresentationUploadResponseSchema.parse({ success: true }));
}

export const SpeakerPresentationPut = openApiRoute(
  speakerPresentationUploadRouteSchema,
  (c) => onRequestPut(c),
  (c) => c.set("sensitive", true),
);

export const SpeakerPresentationGet = openApiRoute(
  speakerPresentationDownloadRouteSchema,
  (c, data) => onRequestGet(c, data.params.token),
  (c) => c.set("sensitive", true),
);
