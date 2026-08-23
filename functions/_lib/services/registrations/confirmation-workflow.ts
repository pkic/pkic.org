import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import type { EventRecord } from "../events";
import { isStaleInviteTransition } from "../invite-lifecycle";
import { registrationManagePageUrl } from "../frontend-links";
import { isStaleRegistrationTransition, prepareConfirmRegistrationByToken } from "./confirm";
import { prepareRegistrationConfirmedEmail } from "./status-notifications";
import { firstReferralCodeQuerySql } from "../referral-code-projection";

export interface ConfirmRegistrationWorkflowPayload {
  event: EventRecord;
  token: string;
  registrationId?: string | null;
  waitlistClaimWindowHours: number;
  signingSecret: string;
  appBaseUrl: string;
  rsvpEmail?: string;
}

/** Commits registration confirmation and its exactly-once email intent together. */
export async function confirmRegistrationWithNotification(
  db: DatabaseLike,
  payload: ConfirmRegistrationWorkflowPayload,
): Promise<{
  registration: Awaited<ReturnType<typeof prepareConfirmRegistrationByToken>>["registration"];
  manageToken: string;
  manageUrl: string;
  shareUrl: string | null;
  outboxId: string;
}> {
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
    signingSecret: payload.signingSecret,
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
  try {
    await db.batch([...prepared.statements, email.statement]);
  } catch (error) {
    if (!isStaleRegistrationTransition(error)) throw error;
    throw new AppError(404, "CONFIRM_TOKEN_INVALID", "Invalid or already-used confirmation token");
  }
  return {
    registration: prepared.registration,
    manageToken: prepared.manageToken,
    // The email outbox stores a queued capability placeholder that is
    // materialized only during delivery. The synchronous confirmation
    // response must use the already signed token returned by the confirmation
    // command, otherwise the browser receives an unusable pkcq1 URL.
    manageUrl: registrationManagePageUrl(payload.appBaseUrl, payload.event, prepared.manageToken),
    shareUrl: referral ? `${payload.appBaseUrl}/r/${referral.code}` : null,
    outboxId: email.outboxId,
  };
}
