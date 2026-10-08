import { useState } from "preact/hooks";
import { z } from "zod";
import { scannerTargetsResponseSchema } from "../../../../../../../shared/schemas/event-participation-scanning";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Button } from "../../../../../../ui/Button";
import { SessionBookings } from "./SessionBookings";
type Session = z.infer<typeof scannerTargetsResponseSchema>["sessions"][number];
export function MySessionManagement({ slug }: { slug: string }) {
  const [selected, setSelected] = useState<Session | null>(null);
  return (
    <section aria-label="My delegated sessions">
      <p>Organizers can delegate invitations and approvals to speakers for their assigned sessions.</p>
      <ApiDataTable<Session, z.infer<typeof scannerTargetsResponseSchema>>
        caption="Sessions I manage"
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/managed-sessions`}
        responseSchema={scannerTargetsResponseSchema}
        resolve={(response) => response.sessions}
        resolvePage={(response) => response.page}
        paginate
        initialSort="title"
        rowKey={(row) => row.id}
        searchPlaceholder="Find a delegated session…"
        empty="No assigned sessions have been delegated to you."
        columns={[
          { header: "Session", sort: { asc: "title", desc: "-title" }, cell: (row) => row.title },
          {
            header: "Manage",
            cell: (row) => (
              <Button type="button" onClick={() => setSelected(row)}>
                Invitations and approvals
              </Button>
            ),
          },
        ]}
      />
      {selected && (
        <>
          <h3>{selected.title}</h3>
          <SessionBookings slug={slug} occurrenceId={selected.id} />
        </>
      )}
    </section>
  );
}
