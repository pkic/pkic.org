import { sponsorLeadCapturesSchema } from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { loadLiveSponsorLeads } from "./sponsor-lead-loader";
export function SponsorLeadCaptures({ endpoint, timeZone }: { endpoint: string; timeZone: string }) {
  return (
    <div class="pk-stack">
      <p>
        Successful lead scans are retained with their operator. Device time is unverified; server receipt shows when
        each scan was uploaded. These records do not imply attendance.
      </p>
      <ApiDataTable
        endpoint={endpoint}
        responseSchema={sponsorLeadCapturesSchema}
        resolve={(value) => value.captures}
        resolvePage={(value) => value.page}
        caption="Lead capture history"
        paginate
        searchPlaceholder="Search operators…"
        initialSort="-receivedAt"
        load={loadLiveSponsorLeads}
        clearDataOnReload
        retainDataOnError={false}
        rowKey={(row) => row.id}
        empty="No capture history is currently available."
        columns={[
          { header: "Operator", cell: (row) => row.operatorName, hideable: false },
          {
            header: "Device time (unverified)",
            cell: (row) => formatDateTimeInZone(row.observedAt, timeZone),
            sort: { asc: "observedAt", desc: "-observedAt" },
          },
          {
            header: "Server receipt",
            cell: (row) => formatDateTimeInZone(row.receivedAt, timeZone),
            sort: { asc: "receivedAt", desc: "-receivedAt" },
          },
        ]}
      />
    </div>
  );
}
