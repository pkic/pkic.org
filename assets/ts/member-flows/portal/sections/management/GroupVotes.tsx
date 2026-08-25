import { groupVotesListResponseSchema } from "../../../../../shared/schemas/group-votes";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { fmt } from "../../ui";
import { ResourceCapabilities } from "./ResourceCapabilities";

export function GroupVotes({ groupId }: { groupId: string }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Votes</div>
      <div class="card-body">
        <ApiDataTable
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/votes`}
          responseSchema={groupVotesListResponseSchema}
          resolve={(response) => response.votes}
          resolvePage={(response) => response.page}
          paginate
          searchPlaceholder="Search votes…"
          initialSort="-closes_at"
          columns={[
            {
              header: "Vote",
              cell: (vote) => (
                <div>
                  <div class="fw-semibold">{vote.title}</div>
                  {vote.description && <div class="small text-muted">{vote.description}</div>}
                </div>
              ),
              sort: { asc: "title", desc: "-title" },
            },
            { header: "Type", cell: (vote) => <Badge status={vote.voteType} /> },
            {
              header: "Status",
              cell: (vote) => <Badge status={vote.status} />,
              sort: { asc: "status", desc: "-status" },
            },
            {
              header: "Closes",
              cell: (vote) => fmt(vote.closesAt),
              className: "text-nowrap",
              sort: { asc: "closes_at", desc: "-closes_at", defaultDirection: "desc" },
            },
            { header: "Access", cell: (vote) => <ResourceCapabilities capabilities={vote.capabilities} /> },
          ]}
          empty="No votes are available through this group."
          rowKey={(vote) => vote.id}
        />
      </div>
    </div>
  );
}
