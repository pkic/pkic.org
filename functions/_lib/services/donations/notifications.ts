import { buildBadgeAttachment } from "../../email/attachments";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { sha256Hex } from "../../utils/crypto";
import { prerenderDonationBadge } from "../og-badge-prerender";
import { formatDonationAmount } from "./amount";
import { getDonationBySession, type DonationRecord } from "./lifecycle";
import { getOrCreateDonationPromoterForRecord } from "./promoter";
import type { DatabaseLike, Env, StatementLike } from "../../types";

export type DonationNotificationKind = "thank_you" | "payment_failed" | "expired";

const REQUIRED_STATUS: Record<DonationNotificationKind, string> = {
  thank_you: "completed",
  payment_failed: "failed",
  expired: "expired",
};

function firstName(name: string): string {
  return name !== "Unknown" ? (name.split(" ")[0] ?? "") : "";
}

export interface PreparedDonationNotification {
  id: string;
  statement: StatementLike;
}

async function queueThankYou(
  db: DatabaseLike,
  env: Env,
  donation: DonationRecord,
  appBaseUrl: string,
  outboxId: string,
  idempotencyKey: string,
): Promise<PreparedDonationNotification> {
  try {
    await prerenderDonationBadge(donation.checkout_session_id, env, appBaseUrl);
  } catch (error) {
    // Delivery remains useful without the optional image attachment.
    console.error("Failed to pre-render donation badge", error);
  }
  const promoter = await getOrCreateDonationPromoterForRecord(db, donation, appBaseUrl);
  const donorFirstName = firstName(donation.name);
  const bcc = env.DONATION_NOTIFICATION_EMAIL ? [env.DONATION_NOTIFICATION_EMAIL] : [];
  return prepareQueueEmailStatement(db, {
    outboxId,
    idempotencyKey,
    baseUrl: appBaseUrl,
    templateKey: "donation_thank_you",
    recipientEmail: donation.email,
    messageType: "transactional",
    subject: "Thank you for your donation to the PKI Consortium",
    attachments: [
      buildBadgeAttachment({
        badgeCode: `donation-${donation.checkout_session_id}`,
        badgeType: "donation",
        firstName: donorFirstName,
        name: donation.name,
      }),
    ],
    data: {
      firstName: donorFirstName,
      name: donation.name,
      email: donation.email,
      organizationName: donation.organization ?? "",
      currency: donation.currency.toUpperCase(),
      formattedAmount: formatDonationAmount(donation.gross_amount, donation.currency),
      donateUrl: `${appBaseUrl}/donate/`,
      shareUrl: promoter?.shareUrl ?? `${appBaseUrl}/donate/`,
      ...(bcc.length > 0 ? { __bccRecipients: bcc } : {}),
    },
  });
}

async function queueUnsuccessfulPayment(
  db: DatabaseLike,
  donation: DonationRecord,
  kind: "payment_failed" | "expired",
  appBaseUrl: string,
  outboxId: string,
  idempotencyKey: string,
): Promise<PreparedDonationNotification> {
  const failed = kind === "payment_failed";
  return prepareQueueEmailStatement(db, {
    outboxId,
    idempotencyKey,
    baseUrl: appBaseUrl,
    templateKey: failed ? "donation_payment_failed" : "donation_expired",
    recipientEmail: donation.email,
    messageType: "transactional",
    subject: failed
      ? "Your donation payment failed — PKI Consortium"
      : "Your donation checkout expired — PKI Consortium",
    data: {
      firstName: firstName(donation.name),
      name: donation.name,
      formattedAmount: formatDonationAmount(donation.gross_amount, donation.currency),
      currency: donation.currency.toUpperCase(),
    },
  });
}

/** Builds an idempotent outbox insert that can share a D1 batch with its state transition. */
export async function prepareDonationNotification(
  db: DatabaseLike,
  env: Env,
  donation: DonationRecord,
  kind: DonationNotificationKind,
  appBaseUrl: string,
): Promise<PreparedDonationNotification | null> {
  if (!donation.email) return null;
  const idempotencyKey = `donation:${donation.id}:${kind}`;
  const outboxId = (await sha256Hex(idempotencyKey)).slice(0, 32);
  return kind === "thank_you"
    ? queueThankYou(db, env, donation, appBaseUrl, outboxId, idempotencyKey)
    : queueUnsuccessfulPayment(db, donation, kind, appBaseUrl, outboxId, idempotencyKey);
}

/** Durable convenience wrapper for an already-committed donation state. */
export async function queueDonationNotification(
  db: DatabaseLike,
  env: Env,
  sessionId: string,
  kind: DonationNotificationKind,
  appBaseUrl: string,
): Promise<string | null> {
  const donation = await getDonationBySession(db, sessionId);
  if (!donation?.email || donation.status !== REQUIRED_STATUS[kind]) return null;
  const prepared = await prepareDonationNotification(db, env, donation, kind, appBaseUrl);
  if (!prepared) return null;
  await db.batch([prepared.statement]);
  return prepared.id;
}
