import type { MembershipWorkflowStep } from "../../../../../shared/schemas/membership-workflows";
import { membershipReviewSummary } from "../../../../../shared/membership-workflow-summary";
import { groupResponseSchema } from "../../../../../shared/schemas/groups";
import { mailingListResponseSchema } from "../../../../../shared/schemas/mailing-lists";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";

export function WorkflowReviewSummary({ step }: { step: MembershipWorkflowStep }) {
  const groupId =
    step.kind === "staff_review"
      ? step.reviewerGroupId
      : step.kind === "consensus" && step.audience.kind === "group"
        ? step.audience.groupId
        : null;
  const listId =
    step.kind === "consensus" && step.destination.kind === "mailing_list" ? step.destination.mailingListId : null;
  const state = useData(async () => {
    const [group, list] = await Promise.all([
      groupId ? getJson(`/api/v1/groups/${encodeURIComponent(groupId)}`, groupResponseSchema) : null,
      listId
        ? getJson(`/api/v1/membership/workflows/destinations/${encodeURIComponent(listId)}`, mailingListResponseSchema)
        : null,
    ]);
    return {
      ...(group && groupId ? { [groupId]: group.group.name } : {}),
      ...(list && listId ? { [listId]: `${list.mailingList.label} (${list.mailingList.email})` } : {}),
    };
  }, [groupId, listId]);
  const summary = membershipReviewSummary(step, state.data ?? {});
  return summary ? (
    <>
      <p>
        Who can respond: {summary.who}.{summary.where && <> Notice goes to {summary.where}.</>}
      </p>
      <ErrorAlert error={state.error} />
    </>
  ) : null;
}
