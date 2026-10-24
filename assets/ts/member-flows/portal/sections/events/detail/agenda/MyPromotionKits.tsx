import { promotionSessionListSchema } from "../../../../../../../shared/schemas/event-agenda";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { PersonalPromotionKit } from "./PersonalPromotionKit";
import { Button } from "../../../../../../ui/Button";
export function MyPromotionKits({ slug, attendeeEligible = false }: { slug: string; attendeeEligible?: boolean }) {
  const [selected, setSelected] = useHashQueryParam("promotionSession", "");
  return (
    <div class="pk-stack">
      <p>
        Download and personalize materials for your sessions or share the event as an attendee. Each kit uses your own
        referral link.
      </p>
      <ApiDataTable
        urlState="promotion-kits"
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/promotion`}
        responseSchema={promotionSessionListSchema}
        resolve={(data) => data.occurrences}
        resolvePage={(data) => data.page}
        caption="My promotion kits"
        paginate
        columns={[
          { header: "Session", cell: (row) => row.title, sort: { asc: "title", desc: "-title" } },
          {
            header: "Promotion materials",
            cell: (row) => <Button onClick={() => setSelected(row.id)}>Open kit</Button>,
          },
        ]}
        rowKey={(row) => row.id}
      />
      {selected && (
        <PersonalPromotionKit
          base={`/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(selected)}/promotion`}
          title="Your session promotion materials"
          onClose={() => setSelected("")}
        />
      )}
      {attendeeEligible && (
        <PersonalPromotionKit
          base={`/api/v1/events/${encodeURIComponent(slug)}/promotion`}
          title="Your attendee promotion materials"
        />
      )}
    </div>
  );
}
