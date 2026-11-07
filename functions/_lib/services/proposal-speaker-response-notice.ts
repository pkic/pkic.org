import { proposalSpeakerReviewPageUrl } from "./frontend-links";
import { first } from "../db/queries";
import { listPermissionHolders } from "../auth/permission-holders";
import { prepareQueueEmailStatement } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { sha256Hex } from "../utils/crypto";
import type { DatabaseLike } from "../types";
import { buildEventEmailVariables, getEventById } from "./events";
import type { SpeakerWithContext } from "./proposals-speaker-capability";

/** Domain keys make retries enqueue each recipient's notice once, in the response's own batch. */
export async function prepareSpeakerResponseNotices(
  db: DatabaseLike,
  context: SpeakerWithContext,
  input: { late: boolean; rejected?: boolean; approved?: boolean; appBaseUrl: string; at: string },
) {
  const { speaker, proposal } = context;
  const event = await getEventById(db, proposal.event_id);
  const proposer = await first<{ id: string; email: string; first_name: string | null }>(
    db,
    "SELECT id,email,first_name FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL",
    [proposal.proposer_user_id],
  );
  const recipients = new Map(proposer ? [[proposer.id, proposer]] : []);
  const reviewers = new Set<string>();
  if (input.late) {
    let afterId = "";
    for (;;) {
      const committee = await listPermissionHolders(db, {
        permission: "proposals:manage",
        context: { type: "event", id: event.id },
        limit: 100,
        afterId,
      });
      for (const person of committee) {
        reviewers.add(person.id);
        recipients.set(person.id, person);
      }
      if (committee.length < 100) break;
      afterId = committee[committee.length - 1]!.id;
    }
  }
  if (input.rejected || input.approved)
    recipients.set(context.user.id, {
      id: context.user.id,
      email: context.user.email,
      first_name: context.user.first_name,
    });
  const notifications = [];
  for (const person of recipients.values()) {
    const key = `proposal_speaker_response:${speaker.id}:${speaker.invite_generation}:${input.rejected ? "rejected" : input.approved ? "approved" : input.late ? "late" : "confirmed"}:${person.id}`;
    notifications.push(
      prepareQueueEmailStatement(
        db,
        {
          outboxId: (await sha256Hex(key)).slice(0, 32),
          idempotencyKey: key,
          eventId: event.id,
          baseUrl: input.appBaseUrl,
          templateKey: "proposal_speaker_response",
          recipientUserId: person.id,
          recipientEmail: person.email,
          messageType: "transactional",
          data: {
            ...buildEventEmailVariables(event, input.appBaseUrl),
            firstName: emailPlainText(person.first_name ?? ""),
            speakerName: emailPlainText(
              [context.user.first_name, context.user.last_name].filter(Boolean).join(" ") || "A speaker",
            ),
            proposalTitle: emailPlainText(proposal.title),
            rejected: input.rejected ?? false,
            late: input.late,
            proposalUrl: reviewers.has(person.id)
              ? proposalSpeakerReviewPageUrl(input.appBaseUrl, event, proposal.id)
              : `${input.appBaseUrl}/portal/#/events/${encodeURIComponent(event.slug)}/proposals/${encodeURIComponent(proposal.id)}`,
          },
        },
        input.at,
      ),
    );
  }
  return notifications;
}
