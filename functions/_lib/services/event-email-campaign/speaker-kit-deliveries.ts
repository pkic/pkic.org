import type { z } from "zod";
import {
  speakerKitDeliveriesResponseSchema,
  type speakerKitDeliveriesQuerySchema,
} from "../../../../assets/shared/schemas/event-email-campaigns";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

interface DeliveryRow {
  id: string;
  created_at: string;
  formats_json: string;
  counts_json: string;
}

/** Tests stay out: this answers what speakers received, not what organizers tried. */
export async function listSpeakerKitDeliveries(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof speakerKitDeliveriesQuerySchema>,
) {
  const { rows, total } = await queryPage<DeliveryRow>(db, {
    source: {
      selectSql: `SELECT batch.id,batch.created_at,batch.formats_json,
        (SELECT json_object(
            'total',COUNT(*),
            'sent',COALESCE(SUM(recipient.email_status='queued' AND mail.status IN('sent','delivery_unknown')),0),
            'failed',COALESCE(SUM(recipient.email_status='failed' OR (recipient.email_status='queued' AND mail.status='failed')),0),
            'alreadySent',COALESCE(SUM(recipient.email_status='already_sent'),0))
          FROM event_promotion_batch_recipients recipient
          LEFT JOIN email_outbox mail ON mail.id=recipient.email_outbox_id
          WHERE recipient.batch_id=batch.id) AS counts_json`,
      fromSql:
        "FROM event_promotion_batches batch WHERE batch.event_id=? AND batch.email_json IS NOT NULL AND json_extract(batch.email_json,'$.test')=0",
      bindings: [eventId],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { createdAt: "batch.created_at" },
      "batch.created_at DESC",
      "batch.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return speakerKitDeliveriesResponseSchema.parse({
    deliveries: rows.map((row) => {
      const counts = JSON.parse(row.counts_json) as {
        total: number;
        sent: number;
        failed: number;
        alreadySent: number;
      };
      return {
        id: row.id,
        createdAt: row.created_at,
        formats: JSON.parse(row.formats_json),
        ...counts,
        pending: counts.total - counts.sent - counts.failed - counts.alreadySent,
      };
    }),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
