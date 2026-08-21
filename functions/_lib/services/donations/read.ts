import type { AdminDonationSummary } from "../../../../assets/shared/schemas/admin-donations";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";

export const ADMIN_DONATION_SELECT_COLUMNS = `
  id, checkout_session_id, payment_intent_id, name, email,
  organization, currency, gross_amount, net_amount, source,
  status, payment_method_type, session_expires_at,
  settled_amount, settled_currency, created_at, completed_at`;

export interface DonationBadgeRecord {
  gross_amount: number;
  currency: string;
  name: string;
  source: string | null;
  completed_at: string | null;
  status: string;
  payment_method_type: string | null;
  session_expires_at: number | null;
}

export async function getAdminDonationById(db: DatabaseLike, donationId: string): Promise<AdminDonationSummary | null> {
  return first<AdminDonationSummary>(db, `SELECT ${ADMIN_DONATION_SELECT_COLUMNS} FROM donations WHERE id = ?`, [
    donationId,
  ]);
}

export async function getDonationBadgeBySession(
  db: DatabaseLike,
  sessionId: string,
): Promise<DonationBadgeRecord | null> {
  return first<DonationBadgeRecord>(
    db,
    `SELECT gross_amount, currency, name, source, completed_at, status,
            payment_method_type, session_expires_at
       FROM donations
      WHERE checkout_session_id = ?`,
    [sessionId],
  );
}
