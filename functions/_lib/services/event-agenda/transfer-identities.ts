import type { z } from "zod";
import type { DatabaseLike } from "../../types";
import { all, first } from "../../db/queries";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { transferIdentitiesQuerySchema } from "../../../../assets/shared/schemas/event-agenda-transfer-identities";
export async function transferIdentityChoices(db: DatabaseLike, query: z.infer<typeof transferIdentitiesQuerySchema>) {
  const where =
    "WHERE identity.user_id=? AND identity.started_at IS NOT NULL AND identity.started_at<=? AND (identity.ended_at IS NULL OR identity.ended_at>?) AND (identity.blocked_at IS NULL OR identity.blocked_at>?) AND INSTR(LOWER(COALESCE(organization.name,'')||' '||COALESCE(identity.job_title,'')),LOWER(?))>0";
  const bindings = [query.userId, query.at, query.at, query.at, query.q ?? ""];
  const from =
    "FROM identities identity LEFT JOIN organizations organization ON organization.id=identity.organization_id";
  const total = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${from} ${where}`, bindings);
  const rows = await all<{
    id: string;
    user_id: string;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
  }>(
    db,
    `SELECT identity.id,identity.user_id,organization.name AS organization_name,identity.job_title,identity.biography ${from} ${where} ORDER BY organization.name,identity.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return {
    identities: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      organizationName: r.organization_name,
      jobTitle: r.job_title,
      biography: r.biography ?? "",
    })),
    page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, rows.length),
  };
}
