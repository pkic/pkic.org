import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { api } from "../../api";
import { toast } from "../../ui";
import type { AdminVoteProposalSummary } from "../../types";

export function ProposalDetail({ proposalId, onDecided }: { proposalId: string; onDecided: () => void }) {
  const [detail, setDetail] = useState<{ proposal: AdminVoteProposalSummary; endorserUserIds: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ proposal: AdminVoteProposalSummary; endorserUserIds: string[] }>(
        `/api/v1/admin/vote-proposals/${proposalId}`,
      );
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/v1/admin/vote-proposals/${proposalId}/approve`, { method: "POST" });
      toast("Converted to an active vote", "success");
      onDecided();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      toast("A reason is required to reject", "error");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/admin/vote-proposals/${proposalId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast("Rejected — proposer notified", "success");
      onDecided();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;
  const { proposal, endorserUserIds } = detail;

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <h6 class="mb-1">{proposal.title}</h6>
        <p class="small mb-2 text-pre-wrap">{proposal.description}</p>
        <p class="small text-muted mb-3">
          <span class="badge text-bg-light me-1 text-capitalize">{proposal.voteType}</span>
          <span class="badge text-bg-light me-1 text-capitalize">{proposal.scopeType.replace("_", " ")}</span>
          Endorsements: {proposal.endorsementCount} / {proposal.minEndorsersRequired}
        </p>
        {endorserUserIds.length > 0 && <p class="small text-muted mb-3">Endorsers: {endorserUserIds.join(", ")}</p>}

        {proposal.status === "open_for_endorsement" && (
          <>
            <div class="mb-2">
              <label class="form-label small">Rejection reason (required to reject)</label>
              <textarea
                class="form-control"
                rows={2}
                value={reason}
                onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
              />
            </div>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-success btn-sm" disabled={busy} onClick={approve}>
                Approve (bypass endorsements)
              </button>
              <button type="button" class="btn btn-outline-danger btn-sm" disabled={busy} onClick={reject}>
                Reject
              </button>
            </div>
          </>
        )}
        {proposal.status !== "open_for_endorsement" && (
          <p class="small mb-0">
            <span class="badge text-bg-secondary text-capitalize">{proposal.status.replace(/_/g, " ")}</span>
            {proposal.rejectionReason && <span class="text-muted ms-2">{proposal.rejectionReason}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
