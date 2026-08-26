import { lazy, Suspense } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import {
  groupVoteBallotsAuditResponseSchema,
  groupVoteMutationResponseSchema,
  groupVoteUpdateInputSchema,
  groupVoteVisibilityUpdateInputSchema,
} from "../../../../../shared/schemas/group-vote-management";
import type { GroupVoteDetail } from "../../../../../shared/schemas/group-votes";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { patchJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { GroupVoteLifecycleActions } from "./GroupVoteLifecycleActions";

const GroupVoteStatistics = lazy(() =>
  import("./GroupVoteStatistics").then((module) => ({ default: module.GroupVoteStatistics })),
);

function localDateTime(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function GroupVoteManagementControls({
  groupId,
  vote,
  onChanged,
}: {
  groupId: string;
  vote: GroupVoteDetail;
  onChanged: () => Promise<void>;
}) {
  const ballotActions = useRef<ApiTableActions | null>(null);
  const [title, setTitle] = useState(vote.title);
  const [description, setDescription] = useState(vote.description ?? "");
  const [opensAt, setOpensAt] = useState(() => localDateTime(vote.opensAt));
  const [closesAt, setClosesAt] = useState(() => localDateTime(vote.closesAt));
  const [visibility, setVisibility] = useState(vote.visibility);
  const [publicDetailLevel, setPublicDetailLevel] = useState(vote.publicDetailLevel);
  const [showBallots, setShowBallots] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(vote.id)}`;

  async function saveSettings(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const input = groupVoteUpdateInputSchema.parse({
        title,
        description: description || null,
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
      });
      await patchJson(`${base}/settings`, input, groupVoteMutationResponseSchema);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update vote settings."));
    } finally {
      setBusy(false);
    }
  }

  async function saveVisibility(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const input = groupVoteVisibilityUpdateInputSchema.parse({ visibility, publicDetailLevel });
      await patchJson(`${base}/visibility`, input, groupVoteMutationResponseSchema);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update vote visibility."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="border rounded p-3 mb-3" aria-label="Vote management">
      <h6>Manage vote</h6>
      <ErrorAlert error={error} />
      <GroupVoteLifecycleActions groupId={groupId} vote={vote} onChanged={onChanged} />

      <div class="row g-3 mb-3">
        <div class="col-md-6">
          <label class="form-label" for={`vote-${vote.id}-title`}>
            Title
          </label>
          <input
            id={`vote-${vote.id}-title`}
            class="form-control"
            maxLength={300}
            required
            value={title}
            disabled={busy}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label" for={`vote-${vote.id}-description`}>
            Description
          </label>
          <input
            id={`vote-${vote.id}-description`}
            class="form-control"
            maxLength={10000}
            value={description}
            disabled={busy}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-5">
          <label class="form-label" for={`vote-${vote.id}-opens`}>
            Opens at
          </label>
          <input
            id={`vote-${vote.id}-opens`}
            type="datetime-local"
            class="form-control"
            required
            value={opensAt}
            disabled={busy}
            onInput={(event) => setOpensAt(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-5">
          <label class="form-label" for={`vote-${vote.id}-closes`}>
            Closes at
          </label>
          <input
            id={`vote-${vote.id}-closes`}
            type="datetime-local"
            class="form-control"
            required
            value={closesAt}
            disabled={busy}
            onInput={(event) => setClosesAt(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-2 d-flex align-items-end">
          <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void saveSettings()}>
            Save settings
          </button>
        </div>
      </div>

      <div class="row g-3 align-items-end mb-3">
        <div class="col-md-4">
          <label class="form-label" for={`vote-${vote.id}-visibility`}>
            Visibility
          </label>
          <select
            id={`vote-${vote.id}-visibility`}
            class="form-select"
            value={visibility}
            disabled={busy}
            onChange={(event) => setVisibility(event.currentTarget.value as typeof visibility)}
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div class="col-md-5">
          <label class="form-label" for={`vote-${vote.id}-public-detail`}>
            Public result detail
          </label>
          <select
            id={`vote-${vote.id}-public-detail`}
            class="form-select"
            value={publicDetailLevel}
            disabled={busy}
            onChange={(event) => setPublicDetailLevel(event.currentTarget.value as typeof publicDetailLevel)}
          >
            <option value="outcome_only">Outcome only</option>
            <option value="aggregate">Aggregate counts</option>
            <option value="full_breakdown">Full breakdown</option>
          </select>
        </div>
        <div class="col-md-3">
          <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void saveVisibility()}>
            Save visibility
          </button>
        </div>
      </div>

      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        aria-expanded={showBallots}
        onClick={() => setShowBallots((shown) => !shown)}
      >
        {showBallots ? "Hide identifiable ballots" : "Load identifiable ballots"}
      </button>
      {showBallots && (
        <div class="mt-3">
          <ApiDataTable
            actionsRef={ballotActions}
            endpoint={`${base}/ballots`}
            responseSchema={groupVoteBallotsAuditResponseSchema}
            resolve={(response) => response.ballots}
            resolvePage={(response) => response.page}
            paginate
            searchPlaceholder="Search ballots…"
            initialSort="-submittedAt"
            columns={[
              { header: "Voter", cell: (ballot) => ballot.userId, sort: { asc: "userId", desc: "-userId" } },
              {
                header: "Member",
                cell: (ballot) => ballot.memberId ?? "—",
                sort: { asc: "memberId", desc: "-memberId" },
              },
              { header: "Choice", cell: (ballot) => ballot.choice, sort: { asc: "choice", desc: "-choice" } },
              { header: "Round", cell: (ballot) => ballot.round, sort: { asc: "round", desc: "-round" } },
              {
                header: "Submitted",
                cell: (ballot) => fmt(ballot.submittedAt),
                sort: { asc: "submittedAt", desc: "-submittedAt", defaultDirection: "desc" },
              },
            ]}
            empty="No ballots have been submitted."
            rowKey={(ballot) => ballot.id}
            className="table-sm"
          />
        </div>
      )}
      <div class="mt-3">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          aria-expanded={showStatistics}
          onClick={() => setShowStatistics((shown) => !shown)}
        >
          {showStatistics ? "Hide vote statistics" : "Load vote statistics"}
        </button>
        {showStatistics && (
          <Suspense fallback={<Spinner />}>
            <GroupVoteStatistics groupId={groupId} voteId={vote.id} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
