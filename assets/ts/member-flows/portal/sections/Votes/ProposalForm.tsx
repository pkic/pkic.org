import { useState } from "preact/hooks";
import { postJson, ApiClientError } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { toast } from "../../ui";
import type { VoteType, VoteScopeType, MyWorkingGroupMembership } from "../../types";

export function ProposalForm({
  myWorkingGroups,
  onCreated,
}: {
  myWorkingGroups: MyWorkingGroupMembership[];
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<VoteType>("motion");
  const [scopeType, setScopeType] = useState<VoteScopeType>("forum");
  const [scopeId, setScopeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    if (scopeType === "working_group" && !scopeId) {
      setError("Choose a working group.");
      return;
    }
    setSubmitting(true);
    try {
      await postJson("/api/v1/portal/vote-proposals", {
        title: title.trim(),
        description: description.trim(),
        voteType,
        scopeType,
        scopeId: scopeType === "working_group" ? scopeId : null,
      });
      toast("Proposal submitted, open for endorsement", "success");
      setTitle("");
      setDescription("");
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not submit your proposal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Propose a vote</div>
      <div class="card-body">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label fw-semibold small">Title</label>
              <input
                class="form-control"
                required
                maxLength={300}
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                disabled={submitting}
              />
            </div>
            <div class="col-12">
              <label class="form-label fw-semibold small">Description</label>
              <textarea
                class="form-control"
                rows={3}
                required
                value={description}
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                disabled={submitting}
              />
            </div>
            <div class="col-sm-6">
              <label class="form-label fw-semibold small">Type</label>
              <select
                class="form-select"
                value={voteType}
                onChange={(e) => setVoteType((e.target as HTMLSelectElement).value as VoteType)}
                disabled={submitting}
              >
                <option value="motion">Motion</option>
                <option value="consultation">Consultation</option>
                <option value="election">Election</option>
              </select>
            </div>
            <div class="col-sm-6">
              <label class="form-label fw-semibold small">Scope</label>
              <select
                class="form-select"
                value={scopeType}
                onChange={(e) => {
                  setScopeType((e.target as HTMLSelectElement).value as VoteScopeType);
                  setScopeId("");
                }}
                disabled={submitting}
              >
                <option value="forum">Forum</option>
                <option value="working_group">Working group</option>
              </select>
            </div>
            {scopeType === "working_group" && (
              <div class="col-12">
                <label class="form-label fw-semibold small">Working group</label>
                <select
                  class="form-select"
                  value={scopeId}
                  onChange={(e) => setScopeId((e.target as HTMLSelectElement).value)}
                  disabled={submitting}
                >
                  <option value="">Choose…</option>
                  {myWorkingGroups.map((wg) => (
                    <option key={wg.workingGroupId} value={wg.workingGroupId}>
                      {wg.name}
                    </option>
                  ))}
                </select>
                {myWorkingGroups.length === 0 && (
                  <div class="form-text">You must be a member of a working group to propose a WG-level vote.</div>
                )}
              </div>
            )}
          </div>

          {error && <ErrorAlert error={error} />}

          <button type="submit" class="btn btn-success mt-3" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit proposal"}
          </button>
        </form>
      </div>
    </div>
  );
}
