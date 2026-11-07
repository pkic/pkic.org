import { personDisplayName } from "../../../assets/shared/person-display";
import { proposalManagePageUrl, proposalSpeakerReviewPageUrl, speakerParticipationPageUrl } from "./frontend-links";
import { queuedCapabilityToken } from "./capability-links";
import { first } from "../db/queries";
import { listPermissionHolders } from "../auth/permission-holders";
import { prepareBulkQueueEmailChunkStatements } from "../email/outbox-queue";
import { emailPlainText } from "../email/plain-text";
import { sha256Hex } from "../utils/crypto";
import type { DatabaseLike } from "../types";
import { buildEventEmailVariables, getEventById, type EventRecord } from "./events";
import type { SpeakerWithContext } from "./proposals-speaker-capability";

/** Domain keys make retries enqueue each recipient's notice once, in bounded bulk inserts in the response batch. */
export async function prepareSpeakerResponseNotices(
  db: DatabaseLike,
  context: SpeakerWithContext,
  input: { late: boolean; rejected?: boolean; approved?: boolean; appBaseUrl: string; at: string; event?: EventRecord },
) {
  const { speaker, proposal } = context;
  const reviewerPage = (afterId = "") =>
    listPermissionHolders(db, {
      permission: "proposals:manage",
      context: { type: "event", id: proposal.event_id },
      limit: 100,
      afterId,
    });
  const [event, proposer, firstReviewers] = await Promise.all([
    input.event ?? getEventById(db, proposal.event_id),
    first<{ id: string; email: string; first_name: string | null }>(
      db,
      "SELECT id,email,first_name FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL",
      [proposal.proposer_user_id],
    ),
    input.late || input.approved ? reviewerPage() : [],
  ]);
  const recipients = new Map(proposer ? [[proposer.id, proposer]] : []);
  const reviewers = new Set<string>();
  let committee = firstReviewers;
  // Cursor reads stay bounded and ordered; writes use the shared bulk outbox builder.
  for (;;) {
    for (const person of committee) {
      reviewers.add(person.id);
      recipients.set(person.id, person);
    }
    if (committee.length < 100) break;
    committee = await reviewerPage(committee[committee.length - 1]!.id);
  }
  if (input.rejected || input.approved)
    recipients.set(context.user.id, {
      id: context.user.id,
      email: context.user.email,
      first_name: context.user.first_name,
    });
  const eventVariables = buildEventEmailVariables(event, input.appBaseUrl);
  const speakerName = personDisplayName(
    { firstName: context.user.first_name, lastName: context.user.last_name },
    "A speaker",
  );
  const notifications = await Promise.all(
    Array.from(recipients.values(), async (person) => {
      const key = `proposal_speaker_response:${speaker.id}:${speaker.invite_generation}:${input.rejected ? "rejected" : input.approved ? "approved" : input.late ? "late" : "confirmed"}:${person.id}`;
      const recipientIsSpeaker = person.id === speaker.user_id;
      const proposerLink = !recipientIsSpeaker && !reviewers.has(person.id);
      const proposalUrl = recipientIsSpeaker
        ? speakerParticipationPageUrl(input.appBaseUrl, event, proposal.id, speaker.user_id)
        : reviewers.has(person.id)
          ? proposalSpeakerReviewPageUrl(input.appBaseUrl, event, proposal.id)
          : proposalManagePageUrl(input.appBaseUrl, event, queuedCapabilityToken("proposal_manage", proposal.id));
      return {
        outboxId: (await sha256Hex(key)).slice(0, 32),
        idempotencyKey: key,
        eventId: event.id,
        templateKey: "proposal_speaker_response",
        recipientUserId: person.id,
        recipientEmail: person.email,
        messageType: "transactional" as const,
        subject: null,
        capabilityLinkValues: proposerLink ? [proposalUrl] : [],
        data: {
          ...eventVariables,
          __baseUrl: input.appBaseUrl,
          firstName: emailPlainText(person.first_name ?? ""),
          speakerName: emailPlainText(speakerName),
          proposalTitle: emailPlainText(proposal.title),
          recipientIsSpeaker,
          approved: input.approved ?? false,
          rejected: input.rejected ?? false,
          late: input.late,
          proposalUrl,
        },
      };
    }),
  );
  return prepareBulkQueueEmailChunkStatements(db, notifications, input.at);
}
