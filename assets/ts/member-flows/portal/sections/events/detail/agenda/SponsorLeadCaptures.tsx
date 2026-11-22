import { type ClockZone } from "../../../../../../../shared/event-clock";
import { sponsorLeadCapturesSchema } from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { loadLiveSponsorLeads } from "./sponsor-lead-loader";

export function SponsorLeadCaptures({ endpoint, timeZone }: { endpoint: string; timeZone: ClockZone }) {
  return (
    <ApiDataTable
      urlState="lead-captures"
      endpoint={endpoint}
      responseSchema={sponsorLeadCapturesSchema}
      resolve={(value) => value.captures}
      resolvePage={(value) => value.page}
      caption="Capture history"
      paginate
      searchPlaceholder="Search operators…"
      initialSort="-receivedAt"
      load={loadLiveSponsorLeads}
      clearDataOnReload
      retainDataOnError={false}
      rowKey={(row) => row.id}
      empty="No capture history is currently available."
      columns={[
        { header: "Scanned by", cell: (row) => row.operatorName, hideable: false },
        {
          header: "Scanned at",
          cell: (row) => formatDateTimeInZone(row.observedAt, timeZone),
          sort: { asc: "observedAt", desc: "-observedAt" },
        },
        {
          header: "Uploaded at",
          cell: (row) => formatDateTimeInZone(row.receivedAt, timeZone),
          sort: { asc: "receivedAt", desc: "-receivedAt" },
        },
      ]}
    />
  );
}
