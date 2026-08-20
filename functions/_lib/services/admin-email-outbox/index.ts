import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { AdminEmailOutboxResponse } from "../../../../assets/shared/schemas/admin-email-outbox";
import type { DatabaseLike } from "../../types";
import { buildAdminEmailOutboxRows } from "./preview";
import { queryAdminEmailOutbox } from "./query";

export async function listAdminEmailOutbox(
  db: DatabaseLike,
  query: {
    status?: string;
    messageType?: string;
    dueNow: boolean;
    q?: string;
    limit: number;
    offset: number;
  },
): Promise<AdminEmailOutboxResponse> {
  const result = await queryAdminEmailOutbox(db, query);
  const outbox = await buildAdminEmailOutboxRows(db, result.rows);

  return {
    outbox,
    summary: {
      total: result.total,
      byStatus: Object.fromEntries(result.statusCounts.map((row) => [row.status, Number(row.count)])),
      byMessageType: Object.fromEntries(result.messageTypeCounts.map((row) => [row.message_type, Number(row.count)])),
      topTemplates: result.templateCounts.map((row) => ({ ...row, count: Number(row.count) })),
      dueNow: result.dueCounts.reduce((sum, row) => sum + Number(row.count), 0),
      dueByStatus: Object.fromEntries(result.dueCounts.map((row) => [row.status, Number(row.count)])),
      nextSendAfter: result.nextSendAfter,
    },
    page: buildPageInfo(query.limit, query.offset, result.total, outbox.length),
  };
}
