import { useState } from "preact/hooks";
import { getJson, postJson, deleteJson, ApiClientError } from "../../../../shared/api-client";
import { Spinner } from "../../../../components/Spinner";
import { profile as profileSignal } from "../../state";
import { toast, fmt, formatStageLabel } from "../../ui";
import {
  proposalDetailResponseSchema,
  endorseProposalResponseSchema,
  withdrawEndorsementResponseSchema,
  withdrawProposalResponseSchema,
} from "../../../../../shared/schemas/votes";
import type { VoteProposal } from "../../types";
import { proposalStatusBadgeClass } from "./shared";
import { GroupBadge } from "./GroupBadge";

export function ProposalCard({ proposal, onChanged }: { proposal: VoteProposal; onChanged: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [endorserUserIds, setEndorserUserIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const isProposer = proposal.proposedByUserId === profileSignal.value?.userId;
  const isOpen = proposal.status === "open_for_endorsement";

  async function fetchEndorsers(): Promise<void> {
    try {
      const data = await getJson(`/api/v1/portal/vote-proposals/${proposal.id}`, proposalDetailResponseSchema);
      setEndorserUserIds(data.endorserUserIds);
    } catch {
      setEndorserUserIds([]);
    }
  }

  async function toggle(): Promise<void> {
    const next = !expanded;
    setExpanded(next);
    if (next && isOpen && endorserUserIds === null) await fetchEndorsers();
  }

  async function endorse(): Promise<void> {
    setBusy(true);
    try {
      await postJson(`/api/v1/portal/vote-proposals/${proposal.id}/endorse`, {}, endorseProposalResponseSchema);
      toast("Endorsement recorded", "success");
      await Promise.all([fetchEndorsers(), onChanged()]);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not endorse this proposal.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawEndorsement(): Promise<void> {
    setBusy(true);
    try {
      await deleteJson(`/api/v1/portal/vote-proposals/${proposal.id}/endorse`, withdrawEndorsementResponseSchema);
      toast("Endorsement withdrawn", "success");
      await Promise.all([fetchEndorsers(), onChanged()]);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not withdraw your endorsement.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawProposal(): Promise<void> {
    if (!confirm("Withdraw this proposal?")) return;
    setBusy(true);
    try {
      await deleteJson(`/api/v1/portal/vote-proposals/${proposal.id}`, withdrawProposalResponseSchema);
      toast("Proposal withdrawn", "success");
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not withdraw this proposal.", "error");
    } finally {
      setBusy(false);
    }
  }

  const hasEndorsed = Boolean(endorserUserIds?.includes(profileSignal.value?.userId ?? ""));

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold">{proposal.title}</span>
              <span class={`badge ${proposalStatusBadgeClass(proposal.status)}`}>
                {formatStageLabel(proposal.status)}
              </span>
              <span class="badge text-bg-light border">{formatStageLabel(proposal.voteType)}</span>
              <span class="badge text-bg-light border">
                <GroupBadge ownerGroupName={proposal.ownerGroupName} />
              </span>
              {isOpen && (
                <span class="badge text-bg-secondary">
                  {proposal.endorsementCount} / {proposal.minEndorsersRequired} endorsements
                </span>
              )}
            </div>
            <p class="text-muted small mb-0 mt-1">Submitted {fmt(proposal.createdAt)}</p>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary flex-shrink-0" onClick={() => void toggle()}>
            {expanded ? "Hide" : "Details"}
          </button>
        </div>

        {expanded && (
          <div class="mt-3 pt-3 border-top">
            <p class="mb-3">{proposal.description}</p>
            {proposal.status === "rejected" && proposal.rejectionReason && (
              <div class="alert alert-danger">{proposal.rejectionReason}</div>
            )}
            {proposal.status === "converted_to_vote" && (
              <p class="text-muted small">This proposal reached its endorsement threshold and is now an active vote.</p>
            )}
            {proposal.status === "withdrawn" && <p class="text-muted small">This proposal was withdrawn.</p>}

            {isOpen && (
              <div class="d-flex align-items-center gap-2 flex-wrap">
                {endorserUserIds === null ? (
                  <Spinner />
                ) : hasEndorsed ? (
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    disabled={busy}
                    onClick={() => void withdrawEndorsement()}
                  >
                    {busy ? "Withdrawing…" : "Withdraw endorsement"}
                  </button>
                ) : (
                  <button type="button" class="btn btn-sm btn-success" disabled={busy} onClick={() => void endorse()}>
                    {busy ? "Endorsing…" : "Endorse"}
                  </button>
                )}
                {isProposer && (
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger"
                    disabled={busy}
                    onClick={() => void withdrawProposal()}
                  >
                    Withdraw proposal
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
