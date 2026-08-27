import { useState } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import type { EcDecisionValue } from "../../../../../shared/schemas/ec-review";

export function ApplicationEcDecisionsCard({
  detail,
  canApprove,
  onRecordEcDecision,
}: {
  detail: MembershipApplicationDetail;
  canApprove: boolean;
  onRecordEcDecision: (params: { ecMemberUserId: string; decision: EcDecisionValue; reason?: string }) => Promise<void>;
}) {
  const [ecMemberUserId, setEcMemberUserId] = useState("");
  const [ecDecision, setEcDecision] = useState<EcDecisionValue>("approve");
  const [ecReason, setEcReason] = useState("");

  async function submitEcDecision(e: Event) {
    e.preventDefault();
    if (!ecMemberUserId.trim()) return;
    await onRecordEcDecision({ ecMemberUserId, decision: ecDecision, reason: ecReason || undefined });
    setEcMemberUserId("");
    setEcReason("");
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">EC decisions</div>
      <div class="card-body">
        <ul class="list-unstyled small mb-3">
          {detail.ecDecisions.map((d) => (
            <li key={d.id} class="mb-1">
              <Badge status={d.decision} /> {d.reason && <span class="text-muted">— {d.reason}</span>}
            </li>
          ))}
          {detail.ecDecisions.length === 0 && <li class="text-muted">None recorded.</li>}
        </ul>
        {canApprove && (
          <form onSubmit={(e) => void submitEcDecision(e)}>
            <div class="mb-1 fw-semibold small">Record on behalf of an EC member (staff override)</div>
            <input
              class="form-control form-control-sm mb-1"
              placeholder="EC member user id"
              value={ecMemberUserId}
              onInput={(e) => setEcMemberUserId((e.target as HTMLInputElement).value)}
            />
            <div class="d-flex gap-2 mb-1">
              <select
                class="form-select form-select-sm w-auto"
                value={ecDecision}
                onChange={(e) => setEcDecision((e.target as HTMLSelectElement).value as EcDecisionValue)}
              >
                <option value="approve">approve</option>
                <option value="decline">decline</option>
              </select>
              <input
                class="form-control form-control-sm"
                placeholder="Reason (required for decline)"
                value={ecReason}
                onInput={(e) => setEcReason((e.target as HTMLInputElement).value)}
              />
            </div>
            <button type="submit" class="btn btn-sm btn-outline-primary">
              Record
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
