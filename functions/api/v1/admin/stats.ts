import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all, first } from "../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

/**
 * GET /api/v1/admin/stats
 *
 * Returns aggregate platform stats suitable for dashboards and automated reporting.
 * Supports both session-token auth and ADMIN_API_KEY.
 */
export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const db = requestDb(c);

  const [
    registrationsByStatus,
    registrationsByAttendanceType,
    invitesByStatus,
    outboxByStatus,
    topEvents,
    recentActivity,
    donationsByCurrency,
    donationTotals,
    donationMonthly,
    donationDaily,
    donationWeekly,
    registrationWeekly,
    registrationMonthly,
  ] = await Promise.all([
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM registrations GROUP BY status`,
      [],
    ),
    all<{ attendance_type: string; count: number }>(
      db,
      `SELECT attendance_type, COUNT(*) AS count FROM registrations GROUP BY attendance_type`,
      [],
    ),
    all<{ status: string; count: number }>(db, `SELECT status, COUNT(*) AS count FROM invites GROUP BY status`, []),
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM email_outbox GROUP BY status`,
      [],
    ),
    all<{ slug: string; name: string; confirmed: number; total: number }>(
      db,
      `SELECT
         e.slug, e.name,
         COUNT(DISTINCT CASE WHEN r.status = 'CONFIRMED' THEN r.id END) AS confirmed,
         COUNT(DISTINCT r.id) AS total
       FROM events e
       LEFT JOIN registrations r ON r.event_id = e.id
       GROUP BY e.id
       ORDER BY confirmed DESC
       LIMIT 10`,
      [],
    ),
    all<{ date: string; registrations: number; invites: number }>(
      db,
      `WITH registration_days AS (
         SELECT date(created_at) AS date, COUNT(*) AS registrations
         FROM registrations
         WHERE created_at >= date('now', '-30 days')
         GROUP BY date(created_at)
       ),
       invite_days AS (
         SELECT date(created_at) AS date, COUNT(*) AS invites
         FROM invites
         WHERE created_at >= date('now', '-30 days')
         GROUP BY date(created_at)
       ),
       activity_days AS (
         SELECT date FROM registration_days
         UNION
         SELECT date FROM invite_days
       )
       SELECT activity_days.date,
              COALESCE(registration_days.registrations, 0) AS registrations,
              COALESCE(invite_days.invites, 0) AS invites
       FROM activity_days
       LEFT JOIN registration_days ON registration_days.date = activity_days.date
       LEFT JOIN invite_days ON invite_days.date = activity_days.date
       ORDER BY activity_days.date ASC`,
      [],
    ),
    all<{
      status: string;
      currency: string;
      count: number;
      total_gross: number;
      avg_gross: number;
      total_net: number | null;
    }>(
      db,
      `SELECT status, currency,
              COUNT(*)                   AS count,
              SUM(gross_amount)          AS total_gross,
              ROUND(AVG(gross_amount))   AS avg_gross,
              SUM(net_amount)            AS total_net,
              SUM(CASE WHEN settled_currency = 'usd' THEN settled_amount
                       WHEN currency = 'usd' THEN gross_amount
                       ELSE NULL END)    AS total_gross_usd
       FROM donations
       GROUP BY status, currency
       ORDER BY status, total_gross_usd DESC NULLS LAST`,

      [],
    ),
    first<{ gross_usd: number; net_usd: number }>(
      db,
      `SELECT
         SUM(CASE WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                  WHEN status = 'completed' AND currency = 'usd' THEN gross_amount
                  ELSE 0 END) AS gross_usd,
         SUM(CASE WHEN status = 'completed' AND currency = 'usd' AND net_amount IS NOT NULL THEN net_amount
                  WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                  ELSE 0 END) AS net_usd
       FROM donations`,
    ),
    all<{
      month: string;
      count: number;
      completed: number;
      pending: number;
      failed: number;
      expired: number;
      gross: number;
    }>(
      db,
      `SELECT strftime('%Y-%m', created_at) AS month,
              COUNT(*) AS count,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
              COUNT(CASE WHEN status = 'pending'   THEN 1 END) AS pending,
              COUNT(CASE WHEN status = 'failed'    THEN 1 END) AS failed,
              COUNT(CASE WHEN status = 'expired'   THEN 1 END) AS expired,
              SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END) AS gross,
              SUM(CASE WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                       WHEN status = 'completed' AND currency = 'usd' THEN gross_amount
                       ELSE 0 END) AS gross_usd,
              SUM(CASE WHEN status = 'completed' AND currency = 'usd' AND net_amount IS NOT NULL THEN net_amount
                       WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                       ELSE 0 END) AS net_usd
       FROM donations
       WHERE created_at >= date('now', '-12 months')
       GROUP BY month
       ORDER BY month ASC`,
      [],
    ),
    all<{
      date: string;
      count: number;
      completed: number;
      pending: number;
      failed: number;
      expired: number;
      gross: number;
    }>(
      db,
      `SELECT date(created_at) AS date,
              COUNT(*) AS count,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
              COUNT(CASE WHEN status = 'pending'   THEN 1 END) AS pending,
              COUNT(CASE WHEN status = 'failed'    THEN 1 END) AS failed,
              COUNT(CASE WHEN status = 'expired'   THEN 1 END) AS expired,
              SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END) AS gross,
              SUM(CASE WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                       WHEN status = 'completed' AND currency = 'usd' THEN gross_amount
                       ELSE 0 END) AS gross_usd,
              SUM(CASE WHEN status = 'completed' AND currency = 'usd' AND net_amount IS NOT NULL THEN net_amount
                       WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                       ELSE 0 END) AS net_usd
       FROM donations
       WHERE created_at >= date('now', '-30 days')
       GROUP BY date(created_at)
       ORDER BY date ASC`,
      [],
    ),
    all<{
      week: string;
      count: number;
      completed: number;
      pending: number;
      failed: number;
      expired: number;
      gross: number;
    }>(
      db,
      `SELECT strftime('%Y-W%W', created_at) AS week,
              COUNT(*) AS count,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
              COUNT(CASE WHEN status = 'pending'   THEN 1 END) AS pending,
              COUNT(CASE WHEN status = 'failed'    THEN 1 END) AS failed,
              COUNT(CASE WHEN status = 'expired'   THEN 1 END) AS expired,
              SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END) AS gross,
              SUM(CASE WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                       WHEN status = 'completed' AND currency = 'usd' THEN gross_amount
                       ELSE 0 END) AS gross_usd,
              SUM(CASE WHEN status = 'completed' AND currency = 'usd' AND net_amount IS NOT NULL THEN net_amount
                       WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                       ELSE 0 END) AS net_usd
       FROM donations
       WHERE created_at >= date('now', '-84 days')
       GROUP BY strftime('%Y-%W', created_at)
       ORDER BY week ASC`,
      [],
    ),
    all<{ week: string; count: number }>(
      db,
      `SELECT strftime('%Y-W%W', created_at) AS week,
              COUNT(*) AS count
       FROM registrations
       WHERE created_at >= date('now', '-84 days')
       GROUP BY strftime('%Y-%W', created_at)
       ORDER BY week ASC`,
      [],
    ),
    all<{ month: string; count: number }>(
      db,
      `SELECT strftime('%Y-%m', created_at) AS month,
              COUNT(*) AS count
       FROM registrations
       WHERE created_at >= date('now', '-12 months')
       GROUP BY month
       ORDER BY month ASC`,
      [],
    ),
  ]);

  // Flatten status arrays into maps
  const toMap = (rows: Array<{ status: string; count: number }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r.count]));

  // Derive per-status count totals from the combined status+currency rows
  const donationsByStatus = donationsByCurrency.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + r.count;
    return acc;
  }, {});

  return json({
    generatedAt: new Date().toISOString(),
    registrations: {
      byStatus: toMap(registrationsByStatus),
      byAttendanceType: Object.fromEntries(registrationsByAttendanceType.map((r) => [r.attendance_type, r.count])),
      total: registrationsByStatus.reduce((s, r) => s + r.count, 0),
      weekly: registrationWeekly,
      monthly: registrationMonthly,
    },
    invites: {
      byStatus: toMap(invitesByStatus),
      total: invitesByStatus.reduce((s, r) => s + r.count, 0),
    },
    email: {
      outboxByStatus: toMap(outboxByStatus),
      totalQueued: outboxByStatus.find((r) => r.status === "queued")?.count ?? 0,
      totalFailed: outboxByStatus.find((r) => r.status === "failed")?.count ?? 0,
      totalBounced: outboxByStatus.find((r) => r.status === "bounced")?.count ?? 0,
    },
    topEvents,
    recentActivity,
    donations: {
      byStatus: donationsByStatus,
      byCurrency: donationsByCurrency,
      totals: {
        gross_usd: donationTotals?.gross_usd ?? 0,
        net_usd: donationTotals?.net_usd ?? 0,
      },
      daily: donationDaily,
      weekly: donationWeekly,
      monthly: donationMonthly,
    },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
