import type { AccountPolicyKey } from "../../../assets/shared/account-policies";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { queueEmailAuthCapability } from "../auth/email-auth-capabilities";
import { findRetiredSignInAddress, queueUserSignInCapability } from "../auth/user-session";
import { normalizeEmail } from "../validation";
import { findUserEmailOwner } from "./user-emails";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import type { DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";
import { first } from "../db/queries";
import { signInPurpose } from "../../../assets/shared/sign-in-purpose";
import { CONSORTIUM_CONTACT_EMAIL } from "../../../assets/shared/consortium-contact";

export const SIGN_IN_UNAVAILABLE_TEMPLATE = "user_sign_in_unavailable";
export const SIGN_IN_HELP_TEMPLATE = "user_sign_in_help";

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

/** Which message carries a link: the plain sign-in one, or the one that starts an account for a purpose. */
interface LinkMessage {
  templateKey: "user_magic_link" | "user_sign_up_link" | "user_account_found_link";
  subject: string;
  data: Record<string, unknown>;
}

const SIGN_IN_MESSAGE: LinkMessage = {
  templateKey: "user_magic_link",
  subject: "Your PKI Consortium sign-in link",
  data: {},
};

/**
 * The message that starts an account names what the person came for, read from where the link returns them.
 * An event is named only when it is public, so the email repeats nothing a stranger could not read anyway.
 */
async function signUpPurposeData(db: DatabaseLike, returnPath: string | undefined): Promise<Record<string, unknown>> {
  const purpose = signInPurpose(returnPath);
  if (!purpose) return {};
  if (purpose.flow === "join") return { join: true };
  const event = await first<{ name: string }>(db, "SELECT name FROM events WHERE slug = ? AND visibility = 'public'", [
    purpose.eventSlug,
  ]);
  return event ? { [purpose.flow]: true, eventName: event.name } : {};
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
  message: LinkMessage = SIGN_IN_MESSAGE,
  /** Where a person whose address has no account starts one; a sign-in request then tells its mailbox so. */
  startUrl?: string,
): Promise<{ outboxId: string | null; identityFound: boolean }> {
  const magic = await queueUserSignInCapability({ db, ...payload });
  if (!magic) {
    const notice = await queueSignInUnavailableNotice(db, payload.email);
    if (notice || !startUrl) return { outboxId: notice, identityFound: false };
    return { outboxId: await queueSignInHelp(db, payload.email, startUrl), identityFound: false };
  }

  const email = prepareQueueEmailStatement(db, {
    templateKey: message.templateKey,
    recipientEmail: magic.recipientEmail,
    recipientUserId: magic.identity.id,
    eventId: null,
    messageType: "transactional",
    subject: message.subject,
    data: {
      ...message.data,
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
  payload: Parameters<typeof requestUserSignInLink>[1] & {
    returnPath?: string;
    personal?: boolean;
    acceptedPolicies: Array<{ termKey: AccountPolicyKey; version: string }>;
  },
): Promise<{ outboxId: string | null }> {
  const purpose = await signUpPurposeData(db, payload.returnPath);
  const message: LinkMessage = { templateKey: "user_sign_up_link", subject: "Confirm your email", data: purpose };
  // An address that already signs in is told its account was found, and its link continues the same flow.
  const signIn = await requestUserSignInLink(db, payload, {
    templateKey: "user_account_found_link",
    subject: "Continue with your PKI Consortium account",
    data: purpose,
  });
  // A retired address was told how to sign in instead; it does not start a second account.
  if (signIn.identityFound || signIn.outboxId) return { outboxId: signIn.outboxId };

  const recipientEmail = normalizeEmail(payload.email);
  // An address an account has already proved cannot start another one. That account does not sign in
  // with it, so no link goes out, but the mailbox learns whom to ask instead of waiting for nothing.
  const owner = await findUserEmailOwner(db, recipientEmail);
  if (owner?.verified) return { outboxId: await queueSignInHelp(db, recipientEmail, null) };
  const capability = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "user_sign_up",
    subjectId: "sign_up",
    email: recipientEmail,
    signUpEmail: recipientEmail,
    signUpPersonal: payload.personal,
    signUpAcceptedPolicies: payload.acceptedPolicies,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const email = prepareQueueEmailStatement(db, {
    templateKey: message.templateKey,
    recipientEmail,
    recipientUserId: null,
    eventId: null,
    messageType: "transactional",
    subject: message.subject,
    data: {
      ...message.data,
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

/**
 * A proved address that stopped signing in when its representation ended gets no link, but its mailbox
 * learns why and how to sign in instead, so the person is not left waiting for
 * a message that never comes. The screen says the same for every address, and
 * nothing goes to any other mailbox, so the request reveals no account.
 */
/**
 * Answers a sign-in request that sends no link: an address without an account learns where to start one
 * (`startUrl`), and a proved address its account cannot sign in with (`startUrl` null) whom to ask. Only
 * the named mailbox hears of it, and the screen says the same for every address.
 */
async function queueSignInHelp(db: DatabaseLike, email: string, startUrl: string | null): Promise<string> {
  const recipientEmail = normalizeEmail(email);
  const owner = startUrl ? await findUserEmailOwner(db, recipientEmail) : null;
  const noAccount = startUrl !== null && !owner?.verified;
  const help = prepareQueueEmailStatement(db, {
    templateKey: SIGN_IN_HELP_TEMPLATE,
    recipientEmail,
    recipientUserId: null,
    eventId: null,
    messageType: "transactional",
    subject: noAccount
      ? "No PKI Consortium account uses this address"
      : "We could not send a PKI Consortium sign-in link",
    data: noAccount
      ? { noAccount: true, email: recipientEmail, startUrl }
      : { email: recipientEmail, contactEmail: CONSORTIUM_CONTACT_EMAIL },
  });
  await db.batch([
    help.statement,
    prepareAuditLog(db, "system", null, "user_sign_in_help_sent", "email_outbox", help.id, { noAccount }),
  ]);
  return help.id;
}

async function queueSignInUnavailableNotice(db: DatabaseLike, email: string): Promise<string | null> {
  const address = await findRetiredSignInAddress(db, email);
  if (!address) return null;
  const notice = prepareQueueEmailStatement(db, {
    templateKey: SIGN_IN_UNAVAILABLE_TEMPLATE,
    recipientEmail: address.email,
    recipientUserId: address.userId,
    eventId: null,
    messageType: "transactional",
    subject: "Sign in to the PKI Consortium another way",
    data: { email: address.email },
  });
  await db.batch([
    notice.statement,
    prepareAuditLog(db, "system", null, "user_sign_in_unavailable_notified", "user", address.userId, {}),
  ]);
  return notice.id;
}
