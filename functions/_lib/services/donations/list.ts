import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { AdminDonationSummary, DonationsListResponse } from "../../../../assets/shared/schemas/admin-donations";
import { resolveOrderBy } from "../../db/sort";
import { batchFirst, batchRows } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import type { DatabaseLike } from "../../types";
import { ADMIN_DONATION_SELECT_COLUMNS } from "./read";

interface StatusCountRow {
  status: string;
  count: number;
}

export async function listDonations(
  db: DatabaseLike,
  params: { status?: string; q?: string; sort?: string; limit: number; offset: number },
): Promise<DonationsListResponse> {
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
  const orderBy = resolveOrderBy(
    params.sort,
    ["name", "gross_amount", "status", "created_at"],
    "ORDER BY created_at DESC",
    "id ASC",
  );

  const [pageResult, countResult, summaryResult] = await db.batch([
    db
      .prepare(
        `SELECT ${ADMIN_DONATION_SELECT_COLUMNS}
           FROM donations
           ${where}
           ${orderBy}
           LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, params.limit, params.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM donations ${where}`).bind(...bindings),
    db.prepare("SELECT status, COUNT(*) AS count FROM donations GROUP BY status"),
  ]);

  const donations = batchRows<AdminDonationSummary>(pageResult);
  const total = Number(batchFirst<{ total: number }>(countResult)?.total ?? 0);
  const summary = Object.fromEntries(
    batchRows<StatusCountRow>(summaryResult).map(({ status, count }) => [status, Number(count)]),
  );

  return {
    donations,
    page: buildPageInfo(params.limit, params.offset, total, donations.length),
    summary,
  };
}
