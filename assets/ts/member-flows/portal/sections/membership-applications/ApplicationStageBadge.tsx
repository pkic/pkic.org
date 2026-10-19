/**
 * An application's stage as one pill everywhere staff see it: the real stage
 * name (Staff review, not Processing) in the tone of the state it is in.
 */
import {
  membershipApplicationStageLabel,
  membershipApplicationStageTone,
} from "../../../../../shared/membership-application-display";
import type { MembershipApplicationSummary } from "../../../../../shared/schemas/membership-application-management";
import { Badge } from "../../../../ui/Badge";

export function ApplicationStageBadge({
  application,
}: {
  application: Pick<MembershipApplicationSummary, "stage" | "currentRequirement">;
}) {
  return (
    <Badge tone={membershipApplicationStageTone(application)}>{membershipApplicationStageLabel(application)}</Badge>
  );
}
