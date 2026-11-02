import { promotionSessionListSchema } from "../../../../../../../shared/schemas/event-agenda";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Checkbox } from "../../../../../../ui/Checkbox";
export function PromotionSessionPicks({
  base,
  selected,
  onChange,
}: {
  base: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <ApiDataTable
      urlState="promotion-picks"
      endpoint={`${base}/sessions`}
      responseSchema={promotionSessionListSchema}
      resolve={(data) => data.occurrences}
      resolvePage={(data) => data.page}
      paginate
      caption="Sessions to share"
      rowKey={(row) => row.id}
      columns={[
        { header: "Session", cell: (row) => row.title, sort: { asc: "title", desc: "-title" } },
        {
          header: "Include",
          cell: (row) => (
            <Checkbox
              label="Include session"
              aria-label={`Include ${row.title}`}
              checked={selected.includes(row.id)}
              onChange={(event) =>
                onChange(event.currentTarget.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))
              }
            />
          ),
        },
      ]}
    />
  );
}
