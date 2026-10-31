import type { ParticipantAuthority } from "../../../../../../_lib/services/participant-authority";
import { requireProfileImageBucket } from "../../../../../../_lib/services/profile-image-storage";
import { OpenAPIRoute } from "chanfana";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { getSpeakerByManageToken } from "../../../../../../_lib/services/proposals";
import { privateUserHeadshotResponse } from "../../../../../../_lib/services/user-headshot";
import {
  removeProposalSpeakerSelfHeadshot,
  uploadProposalSpeakerSelfHeadshot,
} from "../../../../../../_lib/services/proposal-speaker-self-headshot";
import { readValidatedUploadedImage } from "../../../../../../_lib/utils/image-upload";
import { SPEAKER_HEADSHOT_MAX_BYTES } from "../../../../../../../assets/shared/schemas/images";
import {
  proposalSpeakerHeadshotDeleteRouteSchema,
  proposalSpeakerHeadshotGetRouteSchema,
  proposalSpeakerHeadshotPutRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts";
import { proposalSpeakerAccessPath } from "../../../../../../../assets/shared/proposal-access-paths";
import {
  SPEAKER_MAILBOX_PROOF_HEADER,
  speakerMailboxProofHeadersSchema,
} from "../../../../../../../assets/shared/schemas/event-proposal-proof";
import {
  resolveSpeakerAccountAuthority,
  resolveSpeakerMailboxProofAuthority,
  speakerAccountSignInRequiredError,
} from "../../../../../../_lib/services/proposal-speaker-account-authority";
import { AppError } from "../../../../../../_lib/errors";

type SpeakerContext = Awaited<ReturnType<typeof loadContext>>;

async function loadContext(c: AdminContext, token: ParticipantAuthority) {
  c.set?.("sensitive", true);
  return getSpeakerByManageToken(requestDb(c), token, requireInternalSecret(c.env));
}

/** The upload route reads its multipart body itself, so its proof header is parsed here through the shared contract. */
function mailboxProofHeader(c: AdminContext): string | null {
  const parsed = speakerMailboxProofHeadersSchema.safeParse({
    [SPEAKER_MAILBOX_PROOF_HEADER]: c.req.raw.headers.get(SPEAKER_MAILBOX_PROOF_HEADER),
  });
  if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid request");
  return parsed.data[SPEAKER_MAILBOX_PROOF_HEADER] ?? null;
}

/**
 * The photo is the person's: a link alone changes it only on an account whose
 * mailbox was never proved. Otherwise it takes the person's live session, or
 * the mailbox proof they just completed on this link.
 */
async function requireAccountAuthority(
  c: AdminContext,
  token: ParticipantAuthority,
  { proposal, speaker, user }: SpeakerContext,
  mailboxProof: string | null,
) {
  const authority = await resolveSpeakerAccountAuthority(requestDb(c), c.req.raw, c.env, {
    authority: token,
    userId: user.id,
    accountClaimed: user.account_claimed,
  });
  if (authority) return authority;
  if (!mailboxProof) throw speakerAccountSignInRequiredError();
  return resolveSpeakerMailboxProofAuthority({
    signingSecret: requireInternalSecret(c.env),
    continuationToken: mailboxProof,
    eventId: proposal.event_id,
    speakerId: speaker.id,
    userId: user.id,
    inviteGeneration: speaker.invite_generation,
  });
}

export async function onGet(c: AdminContext, token: ParticipantAuthority): Promise<Response> {
  const { user } = await loadContext(c, token);
  if (!user.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }
  return privateUserHeadshotResponse(requireProfileImageBucket(c.env, user.headshot_r2_key), user.headshot_r2_key);
}

export async function onPut(
  c: AdminContext,
  token: ParticipantAuthority,
  mailboxProof: string | null = null,
): Promise<Response> {
  const context = await loadContext(c, token);
  const { proposal, speaker, user } = context;
  if (speaker.status === "declined") {
    return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
  }
  const accountAuthority = await requireAccountAuthority(c, token, context, mailboxProof);

  const image = await readValidatedUploadedImage(c.req.raw, "Headshot", SPEAKER_HEADSHOT_MAX_BYTES);
  const { r2Key, origin } = await uploadProposalSpeakerSelfHeadshot(
    {
      db: requestDb(c),
      env: c.env,
      request: c.req.raw,
      waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
      proposalId: proposal.id,
      proposalSpeakerId: speaker.id,
      userId: user.id,
      proposalStatus: proposal.status,
      proposalUpdatedAt: proposal.updated_at,
      currentStatus: speaker.status,
      inviteGeneration: speaker.invite_generation,
      headshotKey: user.headshot_r2_key,
      accountAuthority,
    },
    image,
  );
  return json({
    success: true,
    r2Key,
    headshotUrl: `${proposalSpeakerAccessPath(`${origin}/api/v1`, token, "headshot")}?v=${encodeURIComponent(String(Date.now()))}`,
  });
}

export async function onDelete(
  c: AdminContext,
  token: ParticipantAuthority,
  mailboxProof: string | null = null,
): Promise<Response> {
  const context = await loadContext(c, token);
  const { proposal, speaker, user } = context;
  if (speaker.status === "declined") {
    return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
  }
  const accountAuthority = await requireAccountAuthority(c, token, context, mailboxProof);
  await removeProposalSpeakerSelfHeadshot({
    db: requestDb(c),
    env: c.env,
    request: c.req.raw,
    waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
    proposalId: proposal.id,
    proposalSpeakerId: speaker.id,
    userId: user.id,
    proposalStatus: proposal.status,
    proposalUpdatedAt: proposal.updated_at,
    currentStatus: speaker.status,
    inviteGeneration: speaker.invite_generation,
    headshotKey: user.headshot_r2_key,
    accountAuthority,
  });
  return json({ success: true });
}

export const ProposalSpeakerHeadshotGet = openApiRoute(proposalSpeakerHeadshotGetRouteSchema, (c, data) =>
  onGet(c, data.params.token),
);

export class ProposalSpeakerHeadshotPut extends OpenAPIRoute {
  schema = proposalSpeakerHeadshotPutRouteSchema;

  async handle(c: AdminContext) {
    return onPut(c, c.req.param("token"), mailboxProofHeader(c));
  }
}

export const ProposalSpeakerHeadshotDelete = openApiRoute(proposalSpeakerHeadshotDeleteRouteSchema, (c, data) =>
  onDelete(c, data.params.token, data.headers[SPEAKER_MAILBOX_PROOF_HEADER] ?? null),
);
