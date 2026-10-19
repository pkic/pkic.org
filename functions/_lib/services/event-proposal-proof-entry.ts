import type { ProposalEntryContext } from "../../../assets/shared/schemas/proposal-entry";
import { parseCapabilityToken } from "../auth/capability-token";
import { issueDatabaseCapability } from "../auth/capability-links";
import { AppError } from "../errors";
import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import { sha256Hex } from "../utils/crypto";
import {
  activeEffectiveInviteExpirySql,
  effectiveInviteExpirySql,
  effectiveStoredInviteExpiry,
} from "../invite-validity";
import { findInviteByToken, type InviteRecord } from "./invites";
import type { EventRecord } from "./events";
import type { EventProposalEntryReceipt } from "./event-proposal-proof-capabilities";

export async function captureEventProposalEntry(
  db: DatabaseLike,
  input: { entryContext?: ProposalEntryContext; event: EventRecord; signingSecret: string },
): Promise<EventProposalEntryReceipt | undefined> {
  if (!input.entryContext) return undefined;
  const { inviteToken, inviteId, ...source } = input.entryContext;
  if (!inviteToken) {
    if (inviteId) throw new AppError(400, "INVITE_INVALID", "An invitation reference requires its invitation link.");
    return source;
  }
  const invite = await findInviteByToken(db, inviteToken, input.signingSecret, inviteId);
  if (invite.event_id !== input.event.id || invite.invite_type !== "speaker")
    throw new AppError(400, "INVITE_INVALID", "Invalid speaker invite.");
  return {
    ...source,
    invite: {
      id: invite.id,
      secretDigest: await sha256Hex(invite.link_secret),
      expiresAt: Math.min(
        parseCapabilityToken(inviteToken, "invite")!.expiresAt,
        Math.floor(Date.parse(effectiveStoredInviteExpiry(input.event, invite.expires_at)!) / 1000),
      ),
    },
  };
}

/** Rechecks the exact original invitation before resuming or committing its entry context. */
export async function prepareEventProposalEntry(
  db: DatabaseLike,
  eventId: string,
  entry: EventProposalEntryReceipt | undefined,
) {
  if (!entry?.invite) return { statements: [], invite: null };
  const invite = await first<Pick<InviteRecord, "id" | "link_secret">>(
    db,
    `SELECT i.id,i.link_secret FROM invites i JOIN events e ON e.id=i.event_id WHERE i.id=? AND i.event_id=? AND i.invite_type='speaker' AND i.status='sent' AND ? > unixepoch('now') AND ${activeEffectiveInviteExpirySql(effectiveInviteExpirySql("i", "e"), "strftime('%Y-%m-%dT%H:%M:%fZ','now')")}`,
    [entry.invite.id, eventId, entry.invite.expiresAt],
  );
  if (!invite || (await sha256Hex(invite.link_secret)) !== entry.invite.secretDigest)
    throw new AppError(410, "PROPOSAL_ENTRY_INVITE_CHANGED", "The original speaker invitation changed or expired.");
  return {
    invite,
    statements: [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM invites i JOIN events e ON e.id=i.event_id WHERE i.id=? AND i.event_id=? AND i.invite_type='speaker' AND i.status='sent' AND i.link_secret=? AND ? > unixepoch('now') AND ${activeEffectiveInviteExpirySql(effectiveInviteExpirySql("i", "e"), "strftime('%Y-%m-%dT%H:%M:%fZ','now')")}`,
        bindings: [entry.invite.id, eventId, invite.link_secret, entry.invite.expiresAt],
      }),
    ],
  };
}

export async function resumeEventProposalEntry(
  db: DatabaseLike,
  input: { eventId: string; entryContext?: EventProposalEntryReceipt; signingSecret: string; proofExpiresAt: number },
): Promise<ProposalEntryContext | undefined> {
  if (!input.entryContext) return undefined;
  await prepareEventProposalEntry(db, input.eventId, input.entryContext);
  const { invite, ...source } = input.entryContext;
  if (!invite) return source;
  const token = await issueDatabaseCapability({
    db,
    signingSecret: input.signingSecret,
    purpose: "invite",
    resourceId: invite.id,
    expectedLinkSecretFingerprint: invite.secretDigest,
    ttlSeconds: Math.min(
      15 * 60,
      invite.expiresAt - Math.floor(Date.now() / 1000),
      input.proofExpiresAt - Math.floor(Date.now() / 1000),
    ),
  });
  return { ...source, inviteId: invite.id, inviteToken: token };
}

export function assertEventProposalEntry(input: {
  entry: EventProposalEntryReceipt | undefined;
  body: ProposalEntryContext;
  acceptedInvite?: InviteRecord | null;
}) {
  if (!input.entry) return;
  for (const key of ["sourceType", "sourceRef", "referralCode"] as const)
    if (input.entry[key] !== input.body[key])
      throw new AppError(
        422,
        "PROPOSAL_ENTRY_CONTEXT_CHANGED",
        "Use the original proposal invitation and source context.",
      );
  if (
    (input.entry.invite?.id ?? null) !== (input.acceptedInvite?.id ?? null) ||
    (input.entry.invite && (!input.body.inviteToken || input.body.inviteId !== input.entry.invite.id))
  )
    throw new AppError(422, "PROPOSAL_ENTRY_CONTEXT_CHANGED", "Use the confirmed original speaker invitation.");
}
