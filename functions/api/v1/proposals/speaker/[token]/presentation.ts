/**
 * Presentation upload endpoint (token-authenticated).
 *
 * PUT /api/v1/proposals/speaker/[token]/presentation
 *   Content-Type: multipart/form-data
 *   Field: "file" — PDF or PowerPoint file (PPTX / ODP / PPTM accepted)
 *
 * The file is stored in the SPEAKER_UPLOADS_BUCKET R2 bucket under a
 * human-searchable event and proposal prefix.
 *
 * Each upload creates a new version in presentation_versions; the previous version is retained.
 * Speakers can re-upload until the deadline.
 */
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { getSpeakerByManageToken } from "../../../../../_lib/services/proposals";
import {
  getPresentationProposalContext,
  requirePresentationBucket,
  uploadProposalPresentation,
} from "../../../../../_lib/services/presentation-upload";
import { requireInternalSecret } from "../../../../../_lib/request";
import { requestDb } from "../../../../../_lib/db/context";

export async function onRequestPut(c: any): Promise<Response> {
  const { speaker, proposal } = await getSpeakerByManageToken(
    requestDb(c),
    c.req.param("token"),
    requireInternalSecret(c.env),
  );

  if (speaker.status === "declined") {
    return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
  }

  const uploadContext = await getPresentationProposalContext(requestDb(c), proposal.id);
  const r2Key = await uploadProposalPresentation(
    requestDb(c),
    requirePresentationBucket(c.env),
    c.req.raw,
    uploadContext,
    {
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
    },
  );

  return json({ success: true, r2Key });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchRequestMethod(c, { PUT: onRequestPut });
}
