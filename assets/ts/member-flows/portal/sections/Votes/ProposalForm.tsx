import { useState } from "preact/hooks";
import type { z } from "zod";
import { postJson, ApiClientError } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { useApiPage } from "../../../../hooks/useApiPage";
import { myWorkingGroupsListResponseSchema } from "../../../../../shared/schemas/me";
import { toast } from "../../ui";
import type { VoteType, VoteScopeType } from "../../types";
import { useAsyncSubmission } from "../../../../hooks/useAsyncSubmission";

export function ProposalForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<VoteType>("motion");
  const [scopeType, setScopeType] = useState<VoteScopeType>("forum");
  const [scopeId, setScopeId] = useState("");
  const [scopeLabel, setScopeLabel] = useState("");
  const [pendingGroupSearch, setPendingGroupSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const submission = useAsyncSubmission();
  const groupsPage = useApiPage<z.infer<typeof myWorkingGroupsListResponseSchema>>(
    "/api/v1/me/working-groups",
    { view: "joined", ...(groupSearch ? { q: groupSearch } : {}) },
    myWorkingGroupsListResponseSchema,
    (data) => data.workingGroups,
  );

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    submission.setError(null);
    if (scopeType === "working_group" && !scopeId) {
      submission.setError("Choose a working group.");
      return;
    }
    submission.begin();
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
      submission.setError(err instanceof ApiClientError ? err.message : "Could not submit your proposal.");
    } finally {
      submission.finish();
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
                disabled={submission.submitting}
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
                disabled={submission.submitting}
              />
            </div>
            <div class="col-sm-6">
              <label class="form-label fw-semibold small">Type</label>
              <select
                class="form-select"
                value={voteType}
                onChange={(e) => setVoteType((e.target as HTMLSelectElement).value as VoteType)}
                disabled={submission.submitting}
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
                  setScopeLabel("");
                }}
                disabled={submission.submitting}
              >
                <option value="forum">Forum</option>
                <option value="working_group">Working group</option>
              </select>
            </div>
            {scopeType === "working_group" && (
              <div class="col-12">
                <label class="form-label fw-semibold small">Working group</label>
                <div class="input-group input-group-sm mb-1">
                  <input
                    type="search"
                    class="form-control"
                    aria-label="Working group search"
                    placeholder="Search joined working groups…"
                    value={pendingGroupSearch}
                    disabled={submission.submitting}
                    onInput={(e) => setPendingGroupSearch((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setGroupSearch(pendingGroupSearch.trim());
                      }
                    }}
                  />
                  <button
                    type="button"
                    class="btn btn-outline-secondary"
                    disabled={submission.submitting}
                    onClick={() => setGroupSearch(pendingGroupSearch.trim())}
                  >
                    Search
                  </button>
                </div>
                <select
                  class="form-select"
                  value={scopeId}
                  onChange={(e) => {
                    const id = (e.target as HTMLSelectElement).value;
                    const selected = groupsPage.data?.workingGroups.find((group) => group.workingGroupId === id);
                    setScopeId(id);
                    setScopeLabel(selected?.name ?? id);
                  }}
                  disabled={submission.submitting || groupsPage.loading}
                >
                  <option value="">Choose…</option>
                  {scopeId && !groupsPage.data?.workingGroups.some((group) => group.workingGroupId === scopeId) && (
                    <option value={scopeId}>{scopeLabel || scopeId}</option>
                  )}
                  {groupsPage.data?.workingGroups.map((wg) => (
                    <option key={wg.workingGroupId} value={wg.workingGroupId}>
                      {wg.name}
                    </option>
                  ))}
                </select>
                {groupsPage.error && <div class="form-text text-danger">Could not load joined working groups.</div>}
                {groupsPage.data?.workingGroups.length === 0 && !groupsPage.loading && (
                  <div class="form-text">You must be a member of a working group to propose a WG-level vote.</div>
                )}
                {groupsPage.pagerProps && <Pager {...groupsPage.pagerProps} />}
              </div>
            )}
          </div>

          {submission.error && <ErrorAlert error={submission.error} />}

          <button type="submit" class="btn btn-success mt-3" disabled={submission.submitting}>
            {submission.submitting ? "Submitting…" : "Submit proposal"}
          </button>
        </form>
      </div>
    </div>
  );
}
