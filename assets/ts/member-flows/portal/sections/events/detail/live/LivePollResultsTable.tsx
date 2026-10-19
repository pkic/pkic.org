import { formatDateTime } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { livePollResultsResponseSchema } from "../../../../../../../shared/schemas/live-session-poll-results";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { FormFieldStatChart } from "../../../../../../components/forms/FormResponseStats";
import { LivePollStatusBadge } from "./LivePollStatusBadge";

/**
 * A session's poll results as reporting keeps them: every poll that opened,
 * read from the durable copy, each with the forms results chart of its
 * question. It needs no live room, so it reads the same after the session.
 */
export function LivePollResultsTable({ slug, occurrenceId }: { slug: string; occurrenceId: string }) {
  return (
    <ApiDataTable
      urlState="live-poll-results"
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/live/polls`}
      responseSchema={livePollResultsResponseSchema}
      resolve={(value) => value.polls}
      resolvePage={(value) => value.page}
      caption="Poll results"
      paginate
      searchPlaceholder="Find a question…"
      initialSort="createdAt"
      rowKey={(row) => row.id}
      empty="No poll has opened in this session yet. Results appear here shortly after one opens."
      detailRow={(row) => <FormFieldStatChart field={row.field} stat={row.results} />}
      columns={[
        { header: "Question", cell: (row) => row.field.label, hideable: false },
        { header: "Status", cell: (row) => <LivePollStatusBadge status={row.status} />, width: "fit" },
        {
          header: "Answered",
          cell: (row) => formatNumber(row.results.totalAnswers),
          sort: { asc: "respondents", desc: "-respondents" },
          align: "end",
          width: "fit",
        },
        {
          header: "Opened",
          cell: (row) => (row.openedAt ? formatDateTime(row.openedAt) : "—"),
          sort: { asc: "openedAt", desc: "-openedAt" },
          width: "fit",
        },
      ]}
    />
  );
}
