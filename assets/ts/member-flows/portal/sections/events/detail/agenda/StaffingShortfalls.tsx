import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaStaffingReasonLabels } from "../../../../../../../shared/event-agenda-staffing";
import { formatNumber } from "../../../../../../../shared/format-number";
/** Successful allocation is advisory; these are current eligibility explanations, not failures. */
export function StaffingShortfalls({ snapshot, requirementId }: { snapshot: AgendaSnapshot; requirementId?: string }) {
  const requirement = snapshot.staffingRequirements.find((row) => row.id === requirementId);
  const uncovered = (snapshot.staffingReport?.uncovered ?? []).filter(
    (row) =>
      !requirement ||
      (row.shiftId === requirement.shiftId && row.role === requirement.roleId && row.postId === requirement.postId),
  );
  return (
    <section class="pk-stack" aria-label="Unfilled staffing duties">
      <p>{formatNumber(uncovered.length)} uncovered duties</p>
      {uncovered.length > 0 && (
        <>
          <p class="pk-muted">
            Review eligible people, their availability and existing duties. A person may have more than one reason;
            these counts are not added together.
          </p>
          <ul class="pk-stack">
            {uncovered.map((item) => (
              <li key={item.positionId ?? `${item.shiftId}:${item.role}`}>
                <strong>
                  {snapshot.shifts.find((shift) => shift.id === item.shiftId)?.name} ·{" "}
                  {snapshot.staffingRoles.find((role) => role.id === item.role)?.name ?? item.role}
                  {item.postId &&
                    ` · ${snapshot.staffingPosts.find((post) => post.id === item.postId)?.name ?? item.postId}`}
                </strong>
                <p>
                  {item.eligiblePeople > 0
                    ? `${formatNumber(item.eligiblePeople)} eligible people remain; assign a person or generate a rotation.`
                    : "No eligible person can cover this position with the current plan."}
                </p>
                {item.reasons.length > 0 ? (
                  <ul>
                    {item.reasons.map((reason) => (
                      <li key={reason.reason}>
                        {agendaStaffingReasonLabels[reason.reason]} ({formatNumber(reason.people)} people)
                      </li>
                    ))}
                  </ul>
                ) : (
                  item.eligiblePeople === 0 && <p>Add people to the eligible roster for this duty.</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
