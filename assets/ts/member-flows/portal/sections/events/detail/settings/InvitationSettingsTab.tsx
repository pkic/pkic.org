/** Settings → Registration → Invitation: the wording and the peer invitation limit. */
import type { EventDetail } from "../../../../../../../shared/schemas/event-management";
import { InvitationMessageSettings } from "./InvitationMessageSettings";
import { PeerInvitationLimitSettings } from "./PeerInvitationLimitSettings";
import type { EventSettingsGroupTarget } from "./useEventSettingsSave";

export function InvitationSettingsTab(props: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
  groupTarget?: EventSettingsGroupTarget;
}) {
  return (
    <div class="pk-stack">
      <InvitationMessageSettings {...props} />
      <PeerInvitationLimitSettings {...props} />
    </div>
  );
}
