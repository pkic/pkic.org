import type { RegistrationOrganizationOutcome } from "../../../../assets/shared/schemas/registration";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import type { EventRecord } from "../events";
import { isStaleInviteTransition } from "../invite-lifecycle";
import { registrationManagePageUrl } from "../frontend-links";
import { isStaleRegistrationTransition, prepareConfirmRegistrationByToken } from "./confirm";
import { prepareRegistrationConfirmedEmail } from "./status-notifications";
import { firstReferralCodeQuerySql } from "../referral-code-projection";
import { nowIso } from "../../utils/time";
import type { RegistrationConfirmOrganization } from "../../../../assets/shared/schemas/registration";
import { linkConfirmedRegistrationOrganization } from "./confirmation-organization";
import { linkVerifiedAddressToDomainOrganization } from "../identities/email-domain-link";

export interface ConfirmRegistrationWorkflowPayload {
  event: EventRecord;
  token: string;
  registrationId?: string | null;
  waitlistClaimWindowHours: number;
  confirmationTtlHours: number;
  signingSecret: string;
  appBaseUrl: string;
  rsvpEmail?: string;
  /** The verified organization selection committed atomically with confirmation. */
  organization?: RegistrationConfirmOrganization;
}

type PreparedConfirmation = Awaited<ReturnType<typeof prepareConfirmRegistrationByToken>>;

export interface ConfirmRegistrationWorkflowResult {
  stage: PreparedConfirmation["stage"];
  registration: PreparedConfirmation["registration"];
  manageToken: string;
  manageUrl: string;
  shareUrl: string | null;
  outboxId: string;
  organizationOutcome: RegistrationOrganizationOutcome | null;
}

async function commitConfirmationIntent(
  db: DatabaseLike,
  prepared: PreparedConfirmation,
  emailStatement: StatementLike,
): Promise<void> {
  try {
    await db.batch([...prepared.statements, emailStatement]);
  } catch (error) {
    if (prepared.affiliationConfirmed && isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "IDENTITY_CONTEXT_CHANGED",
        "Confirm your organization details again before registering.",
      );
    if (!isStaleRegistrationTransition(error)) throw error;
    throw new AppError(404, "CONFIRM_TOKEN_INVALID", "Invalid or already-used confirmation token");
  }
}

function confirmationResult(
  payload: ConfirmRegistrationWorkflowPayload,
  prepared: PreparedConfirmation,
  outboxId: string,
  shareUrl: string | null,
  organizationOutcome: RegistrationOrganizationOutcome | null,
): ConfirmRegistrationWorkflowResult {
  return {
    stage: prepared.stage,
    registration: prepared.registration,
    manageToken: prepared.manageToken,
    // The email outbox stores queued capability placeholders, while this
    // synchronous response must expose the already signed manage token.
    manageUrl: registrationManagePageUrl(payload.appBaseUrl, payload.event, prepared.manageToken),
    shareUrl,
    outboxId,
    organizationOutcome,
  };
}

/** Commits registration confirmation and its exactly-once email intent together. */
export async function confirmRegistrationWithNotification(
  db: DatabaseLike,
  payload: ConfirmRegistrationWorkflowPayload,
): Promise<ConfirmRegistrationWorkflowResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await confirmRegistrationWithNotificationOnce(db, payload);
    } catch (error) {
      if (isStaleInviteTransition(error) && attempt === 0) continue;
      if (isStaleInviteTransition(error)) {
        throw new AppError(409, "INVITE_CHANGED", "Linked invite state changed; please retry confirmation");
      }
      throw error;
    }
  }
  throw new AppError(409, "INVITE_CHANGED", "Linked invite state changed; please retry confirmation");
}

async function confirmRegistrationWithNotificationOnce(
  db: DatabaseLike,
  payload: ConfirmRegistrationWorkflowPayload,
): ReturnType<typeof confirmRegistrationWithNotification> {
  const prepared = await prepareConfirmRegistrationByToken(db, {
    token: payload.token,
    registrationId: payload.registrationId,
    eventId: payload.event.id,
    waitlistClaimWindowHours: payload.waitlistClaimWindowHours,
    confirmationTtlHours: payload.confirmationTtlHours,
    signingSecret: payload.signingSecret,
    organization: payload.organization,
  });
  const referral = await first<{ code: string }>(db, firstReferralCodeQuerySql("registration", "?"), [
    prepared.registration.id,
  ]);
  const idempotencyKey = `registration_confirmed_email:${prepared.registration.id}`;
  const email = await prepareRegistrationConfirmedEmail(db, {
    event: payload.event,
    registrationId: prepared.registration.id,
    registration: prepared.registration,
    appBaseUrl: payload.appBaseUrl,
    recipientEmailOverride: prepared.recipientEmail,
    referralCode: referral?.code ?? null,
    internalSigningSecret: payload.signingSecret,
    rsvpEmail: payload.rsvpEmail,
    idempotencyKey,
    outboxId: (await sha256Hex(idempotencyKey)).slice(0, 32),
  });
  await commitConfirmationIntent(db, prepared, email.statement);
  // The proved address joins the organization its domain belongs to, when the shared rule links it automatically.
  if (!prepared.affiliationConfirmed) await linkVerifiedAddressToDomainOrganization(db, prepared.verifiedAddress);
  // Its own atomic command after the confirmation: the committed confirmation is the mailbox proof,
  // and an organization that needs review never undoes the confirmation itself.
  const organizationOutcome = prepared.affiliationConfirmed
    ? (prepared.organizationOutcome ?? "linked")
    : payload.organization
      ? await linkConfirmedRegistrationOrganization(db, {
          registrationId: prepared.registration.id,
          organization: payload.organization,
          at: nowIso(),
        })
      : null;
  return confirmationResult(
    payload,
    prepared,
    email.outboxId,
    referral ? `${payload.appBaseUrl}/r/${referral.code}` : null,
    organizationOutcome,
  );
}
