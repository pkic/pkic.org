import { GroupMailingListManager } from "./GroupMailingListManager";
import { GroupMailingListPreferences } from "./GroupMailingListPreferences";

/** Composes the separate management and member-preference surfaces for one group context. */
export function GroupMailingLists({
  groupId,
  canManage = false,
  canParticipate = true,
}: {
  groupId: string;
  canManage?: boolean;
  canParticipate?: boolean;
}) {
  return (
    <div>
      {canManage && <GroupMailingListManager groupId={groupId} />}
      {canParticipate && <GroupMailingListPreferences groupId={groupId} />}
    </div>
  );
}
