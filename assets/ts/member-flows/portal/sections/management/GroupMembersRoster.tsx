import { groupMembershipsParticipantListResponseSchema } from "../../../../../shared/schemas/groups";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { PersonCellPreview } from "../../../../components/identities/PersonCellPreview";
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
        urlState="group-roster"
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
              <PersonCellPreview
                name={participant.name || "—"}
                title={participant.jobTitle}
                organization={participant.organizationName}
                avatarSrc={participant.headshotUrl}
                size="sm"
              />
            ),
            sort: { asc: "user_name", desc: "-user_name", defaultDirection: "asc" },
          },
        ]}
        empty={<EmptyState title="No matching members" body="Nobody in this group matches this search." />}
        rowKey={(participant) => `${participant.userId}:${participant.organizationName ?? ""}`}
      />
    </div>
  );
}
