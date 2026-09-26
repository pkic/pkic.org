import { groupMembershipsParticipantListResponseSchema } from "../../../../../shared/schemas/groups";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { PersonCell } from "../../../../components/PersonCell";
import { EmptyState } from "../../../../ui/EmptyState";

/**
 * Read-only roster shown to a participant who cannot manage the group: who
 * else is here, and which organization they represent, if any. The backend
 * projection never includes email addresses or membership-capacity
 * identifiers, so there is nothing here to redact — no row menu, no add
 * action, no management column.
 */
export function GroupMembersRoster({ groupId }: { groupId: string }) {
  return (
    <div class="pk">
      <ApiDataTable
        caption="Members"
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/memberships`}
        responseSchema={groupMembershipsParticipantListResponseSchema}
        resolve={(response) => response.memberships}
        resolvePage={(response) => response.page}
        paginate
        initialSort="user_name"
        searchPlaceholder="Search name or organization…"
        columns={[
          {
            header: "Member",
            width: "primary",
            cell: (participant) => (
              <PersonCell
                firstName={participant.name}
                lastName={null}
                email={null}
                headshotUrl={participant.headshotUrl}
              />
            ),
            sort: { asc: "user_name", desc: "-user_name", defaultDirection: "asc" },
          },
          {
            header: "Represents",
            cell: (participant) => participant.organizationName ?? "—",
            sort: { asc: "organization_name", desc: "-organization_name", defaultDirection: "asc" },
          },
        ]}
        empty={<EmptyState title="No matching members" body="Nobody in this group matches this search." />}
        rowKey={(participant) => `${participant.userId}:${participant.organizationName ?? ""}`}
      />
    </div>
  );
}
