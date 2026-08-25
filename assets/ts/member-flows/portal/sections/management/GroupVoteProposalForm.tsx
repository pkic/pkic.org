import { useState } from "preact/hooks";
import {
  groupVoteProposalCreateResponseSchema,
  groupVoteProposalCreateSchema,
} from "../../../../../shared/schemas/group-vote-proposals";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";

export function GroupVoteProposalForm({ groupId, onCreated }: { groupId: string; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<"motion" | "consultation">("motion");
  const [proposedOpensAt, setProposedOpensAt] = useState("");
  const [proposedClosesAt, setProposedClosesAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = groupVoteProposalCreateSchema.parse({
        title,
        description,
        voteType,
        proposedOpensAt: proposedOpensAt ? new Date(proposedOpensAt).toISOString() : null,
        proposedClosesAt: proposedClosesAt ? new Date(proposedClosesAt).toISOString() : null,
      });
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals`,
        input,
        groupVoteProposalCreateResponseSchema,
      );
      setTitle("");
      setDescription("");
      setProposedOpensAt("");
      setProposedClosesAt("");
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not submit the proposal."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="border rounded p-3 mb-3" onSubmit={(event) => void submit(event)}>
      <h6>Propose a vote</h6>
      <p class="small text-muted">Proposals are opened for endorsement under this group's voting policy.</p>
      <ErrorAlert error={error} />
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label" for="group-vote-proposal-title">
            Title
          </label>
          <input
            id="group-vote-proposal-title"
            class="form-control"
            required
            maxLength={300}
            value={title}
            disabled={saving}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-proposal-type">
            Type
          </label>
          <select
            id="group-vote-proposal-type"
            class="form-select"
            value={voteType}
            disabled={saving}
            onChange={(event) => setVoteType(event.currentTarget.value as typeof voteType)}
          >
            <option value="motion">Motion</option>
            <option value="consultation">Consultation</option>
          </select>
        </div>
        <div class="col-12">
          <label class="form-label" for="group-vote-proposal-description">
            Description
          </label>
          <textarea
            id="group-vote-proposal-description"
            class="form-control"
            rows={4}
            required
            maxLength={10000}
            value={description}
            disabled={saving}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-proposal-opens">
            Proposed opening time (optional)
          </label>
          <input
            id="group-vote-proposal-opens"
            type="datetime-local"
            class="form-control"
            value={proposedOpensAt}
            disabled={saving}
            onInput={(event) => setProposedOpensAt(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-proposal-closes">
            Proposed closing time (optional)
          </label>
          <input
            id="group-vote-proposal-closes"
            type="datetime-local"
            class="form-control"
            value={proposedClosesAt}
            disabled={saving}
            onInput={(event) => setProposedClosesAt(event.currentTarget.value)}
          />
        </div>
      </div>
      <button type="submit" class="btn btn-success mt-3" disabled={saving}>
        {saving ? "Submitting…" : "Submit proposal"}
      </button>
    </form>
  );
}
