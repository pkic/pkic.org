import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { emailPlainText } from "../email/plain-text";
import { prepareQueueEmailStatement } from "../email/outbox";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { SPEAKER_ACCEPTANCE_CONTACT_EMAIL } from "../../../assets/shared/proposal-speaker-acceptance";
import { ownedIdentityAtEvidence } from "./identities/selection";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";
import { buildEventEmailVariables, getEventById, type EventTermRecord } from "./events";
import { prepareProposalActingIdentity } from "./proposal-speaker-identity";
import { proposalSpeakerIdentityIdSql } from "./proposal-speaker-profile-projection";
import type { SpeakerWithContext } from "./proposals-speaker-capability";

/** Pins the identity currently displayed on the roster without asserting personal mailbox verification. */
export async function prepareOrganizerSpeakerIdentity(db: DatabaseLike, context: SpeakerWithContext, at: string) {
  const identity = await first<{
    id: string | null;
    organization_id: string | null;
    organization_name: string | null;
    email_id: string | null;
    email: string;
    updated_at: string | null;
  }>(
    db,
    `SELECT identity.id, identity.organization_id, organization.name AS organization_name,
      identity.email_id, CASE WHEN identity.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END AS email,
      identity.updated_at
    FROM proposal_speakers ps
    JOIN users person ON person.id=ps.user_id AND person.active=1
    LEFT JOIN identities identity ON identity.id=(${proposalSpeakerIdentityIdSql("ps")}) AND identity.user_id=ps.user_id
    LEFT JOIN organizations organization ON organization.id=identity.organization_id
    LEFT JOIN user_emails address ON address.id=identity.email_id AND address.user_id=person.id
    WHERE ps.id=?`,
    [context.speaker.id],
  );
  if (!identity || !identity.email || (context.speaker.acting_identity_id && !identity.id))
    throw new AppError(
      409,
      "SPEAKER_REPRESENTATION_REQUIRED",
      "The speaker needs an available identity and email address.",
    );
  const selected = await prepareProposalActingIdentity(db, {
    userId: context.speaker.user_id,
    actingIdentityId: identity.organization_id ? identity.id : null,
    at,
  });
  const guards = [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM proposal_speakers ps JOIN users person ON person.id=ps.user_id AND person.active=1
        WHERE ps.id=? AND (${proposalSpeakerIdentityIdSql("ps")}) IS ?`,
      bindings: [context.speaker.id, identity.id],
    }),
    prepareAuthorizationGuard(
      db,
      ownedIdentityEmailEvidence({
        userId: context.speaker.user_id,
        emailId: identity.email_id,
        normalizedEmail: identity.email,
        requireVerifiedPrimary: false,
        ...(identity.id ? { identityId: identity.id } : {}),
      }),
    ),
    ...(identity.id && !identity.organization_id
      ? [
          prepareAuthorizationGuard(
            db,
            ownedIdentityAtEvidence({
              userId: context.speaker.user_id,
              identityId: identity.id,
              at,
              ...(identity.updated_at ? { expectedUpdatedAt: identity.updated_at } : {}),
            }),
          ),
        ]
      : []),
    ...selected.guards,
  ];
  return { ...selected, guards, email: identity.email, organizationName: identity.organization_name };
}

/** Supplies the accepted terms snapshot to the editable organizer-confirmation template. */
export async function prepareOrganizerSpeakerNotification(
  db: DatabaseLike,
  context: SpeakerWithContext,
  identity: { email: string; organizationName: string | null },
  terms: EventTermRecord[],
  appBaseUrl: string,
  at: string,
) {
  const event = await getEventById(db, context.proposal.event_id);
  return prepareQueueEmailStatement(
    db,
    {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "proposal_speaker_confirmed_by_organizer",
      recipientUserId: context.speaker.user_id,
      recipientEmail: identity.email,
      replyTo: SPEAKER_ACCEPTANCE_CONTACT_EMAIL,
      messageType: "transactional",
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        eventName: emailPlainText(event.name),
        proposalTitle: emailPlainText(context.proposal.title),
        speakerName: emailPlainText(
          [context.user.first_name, context.user.last_name].filter(Boolean).join(" ") || identity.email,
        ),
        organizationName: emailPlainText(identity.organizationName ?? ""),
        contactEmail: SPEAKER_ACCEPTANCE_CONTACT_EMAIL,
        terms: terms
          .filter((term) => term.required === 1)
          .map((term) => ({
            label: emailPlainText(term.display_text || term.term_key),
            version: emailPlainText(term.version),
            helpText: emailPlainText(term.help_text ?? ""),
            contentRef: emailPlainText(term.content_ref ? new URL(term.content_ref, appBaseUrl).href : ""),
          })),
      },
    },
    at,
  );
}
