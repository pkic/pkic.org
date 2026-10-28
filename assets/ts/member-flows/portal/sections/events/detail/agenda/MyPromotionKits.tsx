import { SharePanel, type SharePanelOptions } from "../../../../../../shared/widgets/share-panel";
import { promotionSessionListSchema } from "../../../../../../../shared/schemas/event-agenda";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { PersonalPromotionKit } from "./PersonalPromotionKit";
import { Button } from "../../../../../../ui/Button";
export function MyPromotionKits({
  slug,
  attendeeEligible = false,
  speakerEligible = true,
  share,
}: {
  slug: string;
  attendeeEligible?: boolean;
  speakerEligible?: boolean;
  share?: SharePanelOptions;
}) {
  const [selected, setSelected] = useHashQueryParam("promotionSession", "");
  if (selected)
    return (
      <PersonalPromotionKit
        base={
          selected === "attendee"
            ? `/api/v1/events/${encodeURIComponent(slug)}/promotion`
            : `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(selected)}/promotion`
        }
        title={selected === "attendee" ? "Your attendee promotion materials" : "Your session promotion materials"}
        onClose={() => setSelected("")}
      />
    );
  return (
    <div class="pk-stack">
      {share && <SharePanel options={share} />}
      {attendeeEligible && <Button onClick={() => setSelected("attendee")}>Create promotion materials</Button>}
      {speakerEligible && (
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
      )}
    </div>
  );
}
