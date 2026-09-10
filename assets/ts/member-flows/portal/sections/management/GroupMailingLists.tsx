import { GroupMailingListManager } from "./GroupMailingListManager";
import { GroupMailingListPreferences } from "./GroupMailingListPreferences";

/** Composes the separate management and member-preference surfaces for one group context. */
export function GroupMailingLists({
  groupId,
  canManage = false,
  canParticipate = true,
  listSegment,
  listTab,
}: {
  groupId: string;
  canManage?: boolean;
  canParticipate?: boolean;
  /** `undefined` for the lists, `"new"` for the create page, or a list id for its record. */
  listSegment?: string;
  /** The URL segment below a list id: the record's active tab. */
  listTab?: string;
}) {
  // A record stands alone. The member's own preferences are a second subject,
  // and leaving them under one list's page would say they belong to that list.
  const onRecord = canManage && listSegment !== undefined;
  return (
    <div>
      {canManage && <GroupMailingListManager groupId={groupId} listSegment={listSegment} listTab={listTab} />}
      {canParticipate && !onRecord && <GroupMailingListPreferences groupId={groupId} />}
    </div>
  );
}
