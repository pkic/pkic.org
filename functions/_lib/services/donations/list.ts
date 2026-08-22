import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  ADMIN_DONATIONS_SORT_COLUMNS,
  type AdminDonationSummary,
  type DonationStatus,
  type DonationsListQuery,
  type DonationsListResponse,
} from "../../../../assets/shared/schemas/admin-donations";
import { resolveOrderBy } from "../../db/sort";
import { batchRows, buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import type { DatabaseLike } from "../../types";
import { ADMIN_DONATION_SELECT_COLUMNS } from "./read";

interface StatusCountRow {
  status: DonationStatus;
  count: number;
  backfillable_count: number;
}

export async function listDonations(db: DatabaseLike, params: DonationsListQuery): Promise<DonationsListResponse> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.status) {
    conditions.push("status = ?");
    bindings.push(params.status);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["name", "email", "organization", "source"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveOrderBy(params.sort, ADMIN_DONATIONS_SORT_COLUMNS, "ORDER BY created_at DESC", "id ASC");

  const [pageStatement, countStatement] = buildOffsetPageStatements(db, {
    sql: `SELECT ${ADMIN_DONATION_SELECT_COLUMNS}
            FROM donations
            ${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  const [pageResult, countResult, summaryResult] = await db.batch([
    pageStatement,
    countStatement,
    db.prepare(
      `SELECT status, COUNT(*) AS count,
              SUM(CASE
                    WHEN status = 'completed' AND (net_amount IS NULL OR payment_method_type IS NULL) THEN 1
                    ELSE 0
                  END) AS backfillable_count
         FROM donations
        GROUP BY status`,
    ),
  ]);

  const { rows: donations, total } = decodeOffsetPageResults<AdminDonationSummary>(pageResult, countResult);
  const statusRows = batchRows<StatusCountRow>(summaryResult);
  const byStatus = Object.fromEntries(statusRows.map(({ status, count }) => [status, Number(count)]));
  const backfillable = statusRows.reduce((sum, row) => sum + Number(row.backfillable_count), 0);
  const syncable = Number(byStatus.pending ?? 0) + Number(byStatus.awaiting_payment ?? 0) + backfillable;

  return {
    donations,
    page: buildPageInfo(params.limit, params.offset, total, donations.length),
    summary: { byStatus, backfillable, syncable },
  };
}
