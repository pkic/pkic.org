import {
  speakerKitDeliveriesResponseSchema,
  type SpeakerKitDelivery,
} from "../../../shared/schemas/event-email-campaigns";
import { ApiDataTable } from "../ApiDataTable";
import { Badge } from "../../ui/Badge";
import { KIT_FORMAT_NAMES } from "./SpeakerKitAttachments";
import { formatNumber } from "../../../shared/format-number";
import { formatDateTime } from "../../../shared/format-date";

const count = (select: (delivery: SpeakerKitDelivery) => number) => ({
  align: "end" as const,
  width: "fit" as const,
  cell: (delivery: SpeakerKitDelivery) => formatNumber(select(delivery)),
});

/** Where each organizer send of speaker kits stands. */
export function SpeakerKitDeliveries({ endpoint }: { endpoint: string }) {
  return (
    <ApiDataTable
      urlState="speaker-kit-sends"
      caption="Speaker kit emails"
      showCaption
      endpoint={endpoint}
      responseSchema={speakerKitDeliveriesResponseSchema}
      resolve={(response) => response.deliveries}
      resolvePage={(response) => response.page}
      paginate
      searchPlaceholder=""
      empty="No speaker kit emails yet. Use Email speakers their kits to choose the formats and review the recipients."
      rowKey={(delivery) => delivery.id}
      initialSort="-createdAt"
      columns={[
        {
          header: "Requested",
          cell: (delivery) => formatDateTime(delivery.createdAt),
          sort: { asc: "createdAt", desc: "-createdAt" },
          width: "fit",
        },
        {
          header: "Formats",
          cell: (delivery) => delivery.formats.map((format) => KIT_FORMAT_NAMES[format]).join(", "),
          width: "primary",
        },
        { header: "Sent", ...count((delivery) => delivery.sent) },
        { header: "Pending", ...count((delivery) => delivery.pending) },
        { header: "Already sent", ...count((delivery) => delivery.alreadySent) },
        {
          header: "Failed",
          align: "end",
          width: "fit",
          cell: (delivery) =>
            delivery.failed ? <Badge tone="danger">{formatNumber(delivery.failed)}</Badge> : formatNumber(0),
        },
      ]}
    />
  );
}
