import { useState } from "preact/hooks";
import {
  ON_HOLD_SUBTYPES,
  allowedTransitions,
  type ApplicationStage,
} from "../../../../../shared/schemas/member-applications";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";

export function ApplicationTransitionCard({
  detail,
  canWrite,
  canApprove,
  onApprove,
  onTransition,
}: {
  detail: MembershipApplicationDetail;
  canWrite: boolean;
  canApprove: boolean;
  onApprove: () => Promise<void>;
  onTransition: (params: { toStage: string; onHoldSubtype?: string; note?: string }) => Promise<void>;
}) {
  const [transitioning, setTransitioning] = useState(false);
  const [toStage, setToStage] = useState("");
  const [onHoldSubtype, setOnHoldSubtype] = useState<string>(ON_HOLD_SUBTYPES[0]);
  const [transitionNote, setTransitionNote] = useState("");

  const availableTransitions = allowedTransitions(detail.stage as ApplicationStage) ?? [];

  async function submitTransition(e: Event) {
    e.preventDefault();
    if (!toStage) return;
    setTransitioning(true);
    try {
      await onTransition({ toStage, onHoldSubtype, note: transitionNote });
      setToStage("");
      setTransitionNote("");
    } finally {
      setTransitioning(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Stage transition</div>
      <div class="card-body">
        {canApprove && detail.stage === "ec_review" && (
          <button type="button" class="btn btn-sm btn-success mb-3" onClick={() => void onApprove()}>
            Approve &amp; run onboarding
          </button>
        )}
        {!canWrite ? null : availableTransitions.length === 0 ? (
          <p class="text-muted small mb-0">No further transitions from this stage.</p>
        ) : (
          <form onSubmit={submitTransition}>
            <div class="row g-2 align-items-end">
              <div class="col-auto">
                <label class="form-label small mb-1">Move to</label>
                <select
                  class="form-select form-select-sm"
                  value={toStage}
                  onChange={(e) => setToStage((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Select…</option>
                  {availableTransitions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              {toStage === "on_hold" && (
                <div class="col-auto">
                  <label class="form-label small mb-1">Reason</label>
                  <select
                    class="form-select form-select-sm"
                    value={onHoldSubtype}
                    onChange={(e) => setOnHoldSubtype((e.target as HTMLSelectElement).value)}
                  >
                    {ON_HOLD_SUBTYPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div class="col">
                <label class="form-label small mb-1">Note (optional)</label>
                <input
                  class="form-control form-control-sm"
                  value={transitionNote}
                  onInput={(e) => setTransitionNote((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-auto">
                <button type="submit" class="btn btn-sm btn-primary" disabled={!toStage || transitioning}>
                  Transition
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
