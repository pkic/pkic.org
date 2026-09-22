import { GroupMailingListManager } from "./GroupMailingListManager";
import { GroupMailingListPreferences } from "./GroupMailingListPreferences";
import { Tabs } from "../../../../components/Tabs";
import { usePortalHashLocation } from "../../hash-location";

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
  const [, navigate] = usePortalHashLocation();
  const base = `/groups/${encodeURIComponent(groupId)}/mailing-lists`;
  const preferences = listSegment === "preferences";
  const onRecord = canManage && listSegment !== undefined && !preferences;
  const path = (key: string) => (key === "preferences" ? `${base}/preferences` : base);
  return (
    <div class="pk pk-stack">
      {canManage && canParticipate && !onRecord && (
        <Tabs
          label="Mailing list sections"
          items={[
            { key: "lists", label: "Mailing lists" },
            { key: "preferences", label: "My preferences" },
          ]}
          active={preferences ? "preferences" : "lists"}
          hrefFor={path}
          onChange={(key) => navigate(path(key))}
        />
      )}
      {canManage && !preferences && (
        <GroupMailingListManager groupId={groupId} listSegment={listSegment} listTab={listTab} />
      )}
      {canParticipate && !onRecord && (!canManage || preferences) && <GroupMailingListPreferences groupId={groupId} />}
    </div>
  );
}
