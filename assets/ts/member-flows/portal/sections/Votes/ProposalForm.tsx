import { useState } from "preact/hooks";
import type { z } from "zod";
import { postJson, ApiClientError } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { useApiPage } from "../../../../hooks/useApiPage";
import { submitProposalResponseSchema } from "../../../../../shared/schemas/votes";
import { selfGroupsListResponseSchema } from "../../../../../shared/schemas/group-participation";
import { toast } from "../../ui";
import type { VoteType } from "../../types";
import { useAsyncSubmission } from "../../../../hooks/useAsyncSubmission";

export function ProposalForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<VoteType>("motion");
  const [ownerGroupId, setOwnerGroupId] = useState("");
  const [ownerGroupLabel, setOwnerGroupLabel] = useState("");
  const [pendingGroupSearch, setPendingGroupSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const submission = useAsyncSubmission();
  const groupsPage = useApiPage<z.infer<typeof selfGroupsListResponseSchema>>(
    "/api/v1/me/groups",
    { view: "joined", ...(groupSearch ? { q: groupSearch } : {}) },
    selfGroupsListResponseSchema,
    (data) => data.groups,
  );

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    submission.setError(null);
    if (!ownerGroupId) {
      submission.setError("Choose the group that owns this proposal.");
      return;
    }
    submission.begin();
    try {
      await postJson(
        "/api/v1/portal/vote-proposals",
        {
          title: title.trim(),
          description: description.trim(),
          voteType,
          ownerGroupId,
        },
        submitProposalResponseSchema,
      );
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
            <div class="col-12">
              <label class="form-label fw-semibold small">Owning group</label>
              <div class="input-group input-group-sm mb-1">
                <input
                  type="search"
                  class="form-control"
                  aria-label="Group search"
                  placeholder="Search your groups…"
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
                value={ownerGroupId}
                onChange={(e) => {
                  const id = (e.target as HTMLSelectElement).value;
                  const selected = groupsPage.data?.groups.find((group) => group.id === id);
                  setOwnerGroupId(id);
                  setOwnerGroupLabel(selected?.name ?? id);
                }}
                disabled={submission.submitting || groupsPage.loading}
              >
                <option value="">Choose…</option>
                {ownerGroupId && !groupsPage.data?.groups.some((group) => group.id === ownerGroupId) && (
                  <option value={ownerGroupId}>{ownerGroupLabel || ownerGroupId}</option>
                )}
                {groupsPage.data?.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} ({group.type.singularLabel})
                  </option>
                ))}
              </select>
              {groupsPage.error && <div class="form-text text-danger">Could not load your groups.</div>}
              {groupsPage.data?.groups.length === 0 && !groupsPage.loading && (
                <div class="form-text">You must participate in a group before proposing a vote.</div>
              )}
              {groupsPage.pagerProps && <Pager {...groupsPage.pagerProps} />}
            </div>
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
