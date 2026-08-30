import { first, run } from "../../db/queries";
import { randomBase62 } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { DatabaseLike } from "../../types";

export interface DonationForPromoter {
  id: string;
  name: string;
  checkout_session_id: string;
}

export interface DonationPromoterLink {
  code: string;
  shareUrl: string;
  ogImageUrl: string;
}

function promoterLink(code: string, sessionId: string, appBaseUrl: string): DonationPromoterLink {
  return {
    code,
    shareUrl: `${appBaseUrl}/donate/r/${encodeURIComponent(code)}`,
    ogImageUrl: `${appBaseUrl}/api/v1/donations/checkouts/${encodeURIComponent(sessionId)}/badge`,
  };
}

/** One concurrency-safe promoter link per completed donation. */
export async function getOrCreateDonationPromoterForRecord(
  db: DatabaseLike,
  donation: DonationForPromoter,
  appBaseUrl: string,
): Promise<DonationPromoterLink> {
  const sessionId = donation.checkout_session_id;
  const existing = await first<{ code: string }>(
    db,
    "SELECT code FROM donation_promoters WHERE donation_id = ? LIMIT 1",
    [donation.id],
  );
  if (existing) return promoterLink(existing.code, sessionId, appBaseUrl);

  const firstName = donation.name.split(" ")[0] ?? null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomBase62(8);
    await run(
      db,
      `INSERT OR IGNORE INTO donation_promoters
         (code, donation_id, checkout_session_id, name, clicks, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [code, donation.id, sessionId, firstName, nowIso()],
    );
    const resolved = await first<{ code: string }>(
      db,
      "SELECT code FROM donation_promoters WHERE donation_id = ? LIMIT 1",
      [donation.id],
    );
    if (resolved) return promoterLink(resolved.code, sessionId, appBaseUrl);
  }
  throw new Error("Unable to allocate a unique donation promoter code");
}

export async function getOrCreateDonationPromoter(
  db: DatabaseLike,
  sessionId: string,
  appBaseUrl: string,
): Promise<DonationPromoterLink | null> {
  const donation = await first<DonationForPromoter>(
    db,
    `SELECT id, name, checkout_session_id
     FROM donations
     WHERE checkout_session_id = ? AND status = 'completed'`,
    [sessionId],
  );
  return donation ? getOrCreateDonationPromoterForRecord(db, donation, appBaseUrl) : null;
}
