import { useState } from "preact/hooks";
import { agendaOccurrenceListSchema, type AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { SessionPromotionKit } from "./SessionPromotionKit";
import { Button } from "../../../../../../ui/Button";
export function MyPromotionKits({ slug }: { slug: string }) {
  const [selected, setSelected] = useState<AgendaOccurrence | null>(null);
  return (
    <div class="pk-stack">
      <p>
        Download reviewed promotion materials for sessions where you are an assigned speaker. Kits use the approved
        public agenda and your event registration referral link.
      </p>
      <ApiDataTable
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/promotion`}
        responseSchema={agendaOccurrenceListSchema}
        resolve={(data) => data.occurrences}
        resolvePage={(data) => data.page}
        caption="My promotion kits"
        paginate
        columns={[
          { header: "Session", cell: (row) => row.title, sort: { asc: "title", desc: "-title" } },
          { header: "Promotion materials", cell: (row) => <Button onClick={() => setSelected(row)}>Open kit</Button> },
        ]}
        rowKey={(row) => row.id}
      />
      {selected && <SessionPromotionKit slug={slug} occurrence={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
