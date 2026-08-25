import { Link } from "wouter";
import { groupResponseSchema } from "../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { GroupMeetingSeriesList } from "./GroupMeetingSeriesList";

export function GroupMeetings({ groupId }: { groupId: string }) {
  const detail = useData(
    () => getJson(`/api/v1/groups/${encodeURIComponent(groupId)}`, groupResponseSchema),
    [groupId],
  );

  if (detail.loading && !detail.data) return <Spinner />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;

  return (
    <div class="d-flex flex-column gap-3 content-width-schedule">
      <div>
        <Link href="/groups" class="small">
          ← All groups
        </Link>
        <h5 class="mb-1 mt-2">{detail.data.group.name}</h5>
        <p class="text-muted small mb-0">Recurring meetings and generated calendars available through this group.</p>
      </div>
      <GroupMeetingSeriesList key={detail.data.group.id} groupId={detail.data.group.id} />
    </div>
  );
}
