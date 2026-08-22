import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type {
  AdminDonationPromoter,
  DonationPromotersListQuery,
  DonationPromotersListResponse,
} from "../../../../assets/shared/schemas/admin-donations";
import { batchFirst, buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

interface PromoterSummaryRow {
  promoter_count: number;
  total_own_gross_usd: number;
  total_attributed_gross_usd: number;
  total_clicks: number;
  total_attributed_completed: number;
}

const PROMOTER_READ_MODEL = `
  WITH attributed AS (
    SELECT source,
           COUNT(*) AS attributed_total,
           COUNT(CASE WHEN status = 'completed' THEN 1 END) AS attributed_completed,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) AS attributed_gross,
           COALESCE(SUM(CASE
             WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
             WHEN status = 'completed' AND currency = 'usd' THEN gross_amount
             ELSE 0
           END), 0) AS attributed_gross_usd
      FROM donations
     WHERE source IS NOT NULL
     GROUP BY source
  ), currency_counts AS (
    SELECT source, currency, COUNT(*) AS currency_count
      FROM donations
     WHERE source IS NOT NULL AND status = 'completed'
     GROUP BY source, currency
  ), dominant_currency AS (
    SELECT candidate.source, candidate.currency
      FROM currency_counts candidate
     WHERE NOT EXISTS (
       SELECT 1
         FROM currency_counts competitor
        WHERE competitor.source = candidate.source
          AND (competitor.currency_count > candidate.currency_count
            OR (competitor.currency_count = candidate.currency_count AND competitor.currency < candidate.currency))
     )
  ), promoter_rows AS (
    SELECT p.code,
           p.name,
           p.checkout_session_id,
           p.clicks,
           COALESCE(own.gross_amount, 0) AS own_gross,
           COALESCE(CASE
             WHEN own.settled_currency = 'usd' THEN own.settled_amount
             WHEN own.currency = 'usd' THEN own.gross_amount
             ELSE 0
           END, 0) AS own_gross_usd,
           own.currency AS own_currency,
           COALESCE(a.attributed_total, 0) AS attributed_total,
           COALESCE(a.attributed_completed, 0) AS attributed_completed,
           COALESCE(a.attributed_gross, 0) AS attributed_gross,
           COALESCE(a.attributed_gross_usd, 0) AS attributed_gross_usd,
           dc.currency,
           p.created_at
      FROM donation_promoters p
      LEFT JOIN donations own ON own.id = p.donation_id AND own.status = 'completed'
      LEFT JOIN attributed a ON a.source = p.code
      LEFT JOIN dominant_currency dc ON dc.source = p.code
  )`;

const PROMOTER_SELECT_COLUMNS = `code, name, checkout_session_id, clicks, own_gross, own_gross_usd, own_currency,
  attributed_total, attributed_completed, attributed_gross, attributed_gross_usd, currency, created_at`;

export async function listDonationPromoters(
  db: DatabaseLike,
  params: DonationPromotersListQuery,
): Promise<DonationPromotersListResponse> {
  const search = params.q ? buildD1TextSearchFilter(params.q, ["code", "name"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const bindings = search?.bindings ?? [];
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      impact: "(own_gross_usd + attributed_gross_usd)",
      clicks: "clicks",
      donated: "attributed_completed",
      createdAt: "created_at",
    },
    "(own_gross_usd + attributed_gross_usd) DESC",
    "code ASC",
  );

  const [pageStatement, countStatement] = buildOffsetPageStatements(db, {
    sql: `${PROMOTER_READ_MODEL} SELECT ${PROMOTER_SELECT_COLUMNS} FROM promoter_rows ${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  const [pageResult, countResult, summaryResult] = await db.batch([
    pageStatement,
    countStatement,
    db
      .prepare(
        `${PROMOTER_READ_MODEL}
       SELECT COUNT(*) AS promoter_count,
              COALESCE(SUM(own_gross_usd), 0) AS total_own_gross_usd,
              COALESCE(SUM(attributed_gross_usd), 0) AS total_attributed_gross_usd,
              COALESCE(SUM(clicks), 0) AS total_clicks,
              COALESCE(SUM(attributed_completed), 0) AS total_attributed_completed
         FROM promoter_rows ${where}`,
      )
      .bind(...bindings),
  ]);

  const { rows: promoters, total } = decodeOffsetPageResults<AdminDonationPromoter>(pageResult, countResult);
  const summary = batchFirst<PromoterSummaryRow>(summaryResult);
  return {
    promoters,
    page: buildPageInfo(params.limit, params.offset, total, promoters.length),
    summary: {
      promoterCount: summary?.promoter_count ?? 0,
      totalOwnGrossUsd: summary?.total_own_gross_usd ?? 0,
      totalAttributedGrossUsd: summary?.total_attributed_gross_usd ?? 0,
      totalClicks: summary?.total_clicks ?? 0,
      totalAttributedCompleted: summary?.total_attributed_completed ?? 0,
    },
  };
}
