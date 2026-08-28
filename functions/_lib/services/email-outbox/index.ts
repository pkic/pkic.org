import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { EmailOutboxResponse, EmailOutboxQuery } from "../../../../assets/shared/schemas/email-outbox";
import type { DatabaseLike } from "../../types";
import { buildEmailOutboxRows } from "./preview";
import { queryEmailOutbox } from "./query";

export { authorizedEmailOutboxMutationDb } from "./authorization";
export { processEmailOutboxCommand, resetFailedEmailOutboxCommand } from "./operator-processing";

export async function listEmailOutbox(db: DatabaseLike, query: EmailOutboxQuery): Promise<EmailOutboxResponse> {
  const result = await queryEmailOutbox(db, query);
  const outbox = await buildEmailOutboxRows(db, result.rows);

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
