import type { AuthAdmin, DatabaseLike } from "../../types";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { requireGroupEventProposalContext, prepareGroupEventProposalContextGuard } from "../proposal-group-context";
import { getEventById, buildEventEmailVariables } from "../events";
import { registrationPageUrl, proposalPageUrl, inviteDeclineUrl } from "../frontend-links";
import { resolveEventInviteExpiry } from "../../invite-validity";
import { requireValidEventInviteRecipientBatch, type EventInviteType } from "../event-invite-preview";
import { buildEventInvitePreview } from "../event-invite-preview-email";
import { buildEventInviteRecipientVariables } from "../event-invite-email-variables";
import { bulkCreateAttendeeInvites, bulkCreateSpeakerInvites } from "../invites";
import type { BulkInviteOutcome } from "../invite-bulk";
import {
  guardEventResourceManagementDatabase,
  requireEventResourceManagementContext,
} from "../event-series/management";

type InviteInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  sourceType?: string;
};

export interface GroupInvitePreview {
  previewToken: string;
  previewExpiresAt: string;
  inviteDigest: string;
  sendBatches: Array<{ offset: number; count: number; previewToken: string; inviteDigest: string }>;
  inviteExpiresAt: string;
  recipientCount: number;
  subject: string;
  html: string;
  text: string;
}

export interface GroupInviteResult {
  created: Array<{ email: string }>;
  endorsed: Array<{ email: string }>;
  skipped: Array<{ email: string }>;
}

function resultBuckets(outcomes: BulkInviteOutcome[]): GroupInviteResult {
  const created: Array<{ email: string }> = [];
  const endorsed: Array<{ email: string }> = [];
  const skipped: Array<{ email: string }> = [];
  for (const outcome of outcomes) {
    if (outcome.status === "created") created.push({ email: outcome.email });
    else if (outcome.status === "endorsed") endorsed.push({ email: outcome.email });
    else skipped.push({ email: outcome.email });
  }
  return { created, endorsed, skipped };
}

function invitePayload(invites: InviteInput[]) {
  return invites.map((invite) => ({
    inviteeEmail: invite.email,
    inviteeFirstName: invite.firstName ?? null,
    inviteeLastName: invite.lastName ?? null,
    sourceType: invite.sourceType,
  }));
}

async function preview(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventId: string,
  type: EventInviteType,
  input: { invites: InviteInput[]; expiresAt?: string },
  appBaseUrl: string,
  signingSecret: string,
): Promise<GroupInvitePreview> {
  return buildEventInvitePreview({
    db,
    event: await getEventById(db, eventId),
    appBaseUrl,
    signingSecret,
    actorId: actor.id,
    inviteType: type,
    invites: input.invites,
    expiresAt: input.expiresAt,
  });
}

async function checkPreview(
  event: Awaited<ReturnType<typeof getEventById>>,
  actor: AuthAdmin,
  type: EventInviteType,
  input: { previewToken: string; inviteDigest: string; expiresAt?: string; invites: InviteInput[] },
  signingSecret: string,
): Promise<string> {
  const expiresAt = resolveEventInviteExpiry(event, input.expiresAt);
  await requireValidEventInviteRecipientBatch({
    secret: signingSecret,
    token: input.previewToken,
    eventId: event.id,
    actorId: actor.id,
    inviteType: type,
    invites: input.invites,
    expiresAt,
    inviteDigest: input.inviteDigest,
  });
  return expiresAt;
}

export async function previewGroupEventAttendeeInvites(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  input: { invites: InviteInput[]; expiresAt?: string },
  appBaseUrl: string,
  signingSecret: string,
) {
  await requireEventResourceManagementContext(db, actor, groupId, eventId, "manage");
  return preview(db, actor, eventId, "attendee", input, appBaseUrl, signingSecret);
}

export async function bulkCreateGroupEventAttendeeInvites(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  input: { previewToken: string; inviteDigest: string; expiresAt?: string; invites: InviteInput[] },
  appBaseUrl: string,
  signingSecret: string,
) {
  const context = await requireEventResourceManagementContext(db, actor, groupId, eventId, "manage");
  const guardedDb = guardEventResourceManagementDatabase(db, actor, context, "manage");
  const event = await getEventById(guardedDb, eventId);
  const expiresAt = await checkPreview(event, actor, "attendee", input, signingSecret);
  const emailVariables = buildEventEmailVariables(event, appBaseUrl);
  return resultBuckets(
    await bulkCreateAttendeeInvites(guardedDb, {
      event,
      expiresAt,
      invites: invitePayload(input.invites),
      buildEmailRow: ({ email, inviteId, token, invite, linkSecretFingerprint }) => {
        const registrationUrl = registrationPageUrl(appBaseUrl, event, { invite: token, inviteId, source: "invite" });
        const declineUrl = inviteDeclineUrl(appBaseUrl, event, token, inviteId);
        return {
          eventId: event.id,
          recipientEmail: email,
          templateKey: "attendee_invite",
          subject: `Invitation: ${event.name}`,
          capabilityLinkValues: [registrationUrl, declineUrl],
          linkSecretFingerprint,
          data: {
            ...emailVariables,
            ...buildEventInviteRecipientVariables(
              { firstName: invite.inviteeFirstName, lastName: invite.inviteeLastName },
              "Attendee",
            ),
            registrationUrl,
            declineUrl,
          },
        };
      },
    }),
  );
}

async function speakerContext(db: DatabaseLike, actor: AuthAdmin, groupId: string, eventId: string) {
  return requireGroupEventProposalContext(db, actor, groupId, eventId, "proposals:manage");
}

export async function previewGroupEventSpeakerInvites(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  input: { invites: InviteInput[]; expiresAt?: string },
  appBaseUrl: string,
  signingSecret: string,
) {
  const context = await speakerContext(db, actor, groupId, eventId);
  return preview(db, actor, context.eventId, "speaker", input, appBaseUrl, signingSecret);
}

export async function bulkCreateGroupEventSpeakerInvites(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  eventId: string,
  input: { previewToken: string; inviteDigest: string; expiresAt?: string; invites: InviteInput[] },
  appBaseUrl: string,
  signingSecret: string,
) {
  const context = await speakerContext(db, actor, groupId, eventId);
  const event = await getEventById(db, context.eventId);
  const expiresAt = await checkPreview(event, actor, "speaker", input, signingSecret);
  const emailVariables = buildEventEmailVariables(event, appBaseUrl);
  return resultBuckets(
    await bulkCreateSpeakerInvites(db, {
      event,
      expiresAt,
      invites: invitePayload(input.invites),
      additionalStatements: [
        prepareGroupEventProposalContextGuard(db, context),
        preparePermissionsAuthorizationGuard(db, actor, [
          { permission: "proposals:manage", context: { type: "event", id: event.id } },
        ]),
      ],
      buildEmailRow: ({ email, inviteId, token, invite, linkSecretFingerprint }) => {
        const proposalUrl = proposalPageUrl(appBaseUrl, event, { invite: token, inviteId, source: "speaker_invite" });
        const declineUrl = inviteDeclineUrl(appBaseUrl, event, token, inviteId);
        return {
          eventId: event.id,
          recipientEmail: email,
          templateKey: "speaker_invite",
          subject: `Speaker invitation: ${event.name}`,
          capabilityLinkValues: [proposalUrl, declineUrl],
          linkSecretFingerprint,
          data: {
            ...emailVariables,
            ...buildEventInviteRecipientVariables(
              { firstName: invite.inviteeFirstName, lastName: invite.inviteeLastName },
              "Speaker",
            ),
            proposalUrl,
            declineUrl,
          },
        };
      },
    }),
  );
}
