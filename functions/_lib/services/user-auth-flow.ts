import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { queueEmailAuthCapability } from "../auth/email-auth-capabilities";
import { queueUserSignInCapability } from "../auth/user-session";
import { normalizeEmail } from "../validation";
import { findUserEmailOwner } from "./user-emails";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import type { DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";

/**
 * The verify route a sign-in link opens. A return path rides along as `next`
 * so the portal can land the reader where the sign-in started — a working
 * group they came to join — even when the email opens in a fresh tab.
 */
export function portalVerifyLinkBase(appBaseUrl: string, returnPath?: string): string {
  const base = `${appBaseUrl}/portal/#/verify`;
  return returnPath ? `${base}?next=${encodeURIComponent(returnPath)}` : base;
}

/** A portal route with an emailed capability token appended to its hash query. */
export function capabilityLinkUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  const separator = url.hash.includes("?") ? "&" : "?";
  url.hash = `${url.hash}${separator}token=${encodeURIComponent(token)}`;
  return url.toString();
}

export async function requestUserSignInLink(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash: string | null;
    userAgentHash: string | null;
    ttlMinutes: number;
    magicLinkBaseUrl: string;
    signingSecret: string;
  },
): Promise<{ outboxId: string | null; identityFound: boolean }> {
  const magic = await queueUserSignInCapability({ db, ...payload });
  if (!magic) return { outboxId: null, identityFound: false };

  const email = prepareQueueEmailStatement(db, {
    templateKey: "user_magic_link",
    recipientEmail: magic.recipientEmail,
    recipientUserId: magic.identity.id,
    eventId: null,
    messageType: "transactional",
    subject: "Your PKI Consortium sign-in link",
    data: {
      email: magic.recipientEmail,
      magicLinkUrl: capabilityLinkUrl(payload.magicLinkBaseUrl, magic.queuedToken),
      expiresInMinutes: payload.ttlMinutes,
    },
    capabilityLinkValues: [magic.queuedToken],
  });

  try {
    await db.batch([
      prepareAuthorizationGuard(db, magic.authorizationEvidence),
      email.statement,
      prepareAuditLog(db, "user", magic.identity.id, "user_magic_link_requested", "user_identity", magic.identity.id, {
        capacities: magic.capacities,
        email: magic.recipientEmail,
      }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) return { outboxId: null, identityFound: false };
    throw error;
  }
  return { outboxId: email.id, identityFound: true };
}

/**
 * Starting an account. An address that already signs in gets the ordinary
 * sign-in link; any other address gets a link that proves it and creates the
 * account when opened. Both are the same email from the same screen, so the
 * request never says which address has an account.
 */
export async function requestUserSignUpLink(
  db: DatabaseLike,
  payload: Parameters<typeof requestUserSignInLink>[1],
): Promise<{ outboxId: string | null }> {
  const signIn = await requestUserSignInLink(db, payload);
  if (signIn.identityFound) return { outboxId: signIn.outboxId };

  const recipientEmail = normalizeEmail(payload.email);
  // An address an account has already proved cannot start another one. It did not get a sign-in link
  // above, so that account does not sign in with it; nothing is sent, as for any refused sign-in.
  const owner = await findUserEmailOwner(db, recipientEmail);
  if (owner?.verified) return { outboxId: null };
  const capability = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "user_sign_up",
    subjectId: "sign_up",
    email: recipientEmail,
    signUpEmail: recipientEmail,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const email = prepareQueueEmailStatement(db, {
    templateKey: "user_magic_link",
    recipientEmail,
    recipientUserId: null,
    eventId: null,
    messageType: "transactional",
    subject: "Your PKI Consortium sign-in link",
    data: {
      email: recipientEmail,
      magicLinkUrl: capabilityLinkUrl(payload.magicLinkBaseUrl, capability.queuedToken),
      expiresInMinutes: payload.ttlMinutes,
    },
    capabilityLinkValues: [capability.queuedToken],
  });
  await db.batch([
    email.statement,
    prepareAuditLog(db, "system", null, "user_sign_up_link_requested", "email_outbox", email.id, {}),
  ]);
  return { outboxId: email.id };
}
