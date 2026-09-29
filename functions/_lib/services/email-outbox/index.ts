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
    page: buildPageInfo(query.limit, query.offset, result.total, outbox.length),
  };
}
