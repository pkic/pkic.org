import { useRef, useState } from "preact/hooks";
import {
  groupVoteProposalApproveResponseSchema,
  groupVoteProposalDetailResponseSchema,
  groupVoteProposalEndorseResponseSchema,
  groupVoteProposalMutationResponseSchema,
  groupVoteProposalRejectResponseSchema,
  groupVoteProposalsListResponseSchema,
  type GroupVoteProposal,
} from "../../../../../shared/schemas/group-vote-proposals";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { deleteJson, getJson, postJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { GroupVoteProposalForm } from "./GroupVoteProposalForm";

function GroupVoteProposalDetail({
  groupId,
  proposal,
  onChanged,
}: {
  groupId: string;
  proposal: GroupVoteProposal;
  onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals/${encodeURIComponent(proposal.id)}`;
  const detail = useData(() => getJson(base, groupVoteProposalDetailResponseSchema), [base]);

  async function action(request: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await request();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update the proposal."));
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) return <Spinner />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  const current = detail.data?.proposal ?? proposal;

  return (
    <div class="border rounded p-3">
      <h6>{current.title}</h6>
      <p>{current.description}</p>
      <p class="small text-muted">
        {current.endorsementCount} of {current.minEndorsersRequired} required endorsements
      </p>
      {current.rejectionReason && <div class="alert alert-danger">{current.rejectionReason}</div>}
      <ErrorAlert error={error} />
      <div class="d-flex gap-2 flex-wrap">
        {current.capabilities.includes("endorse") && (
          <button
            type="button"
            class="btn btn-sm btn-success"
            disabled={busy}
            onClick={() => void action(() => postJson(`${base}/endorse`, {}, groupVoteProposalEndorseResponseSchema))}
          >
            Endorse
          </button>
        )}
        {current.capabilities.includes("withdraw_endorsement") && (
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            disabled={busy}
            onClick={() => void action(() => deleteJson(`${base}/endorse`, groupVoteProposalMutationResponseSchema))}
          >
            Withdraw endorsement
          </button>
        )}
        {current.capabilities.includes("withdraw") && (
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Withdraw this proposal?"))
                void action(() => deleteJson(base, groupVoteProposalMutationResponseSchema));
            }}
          >
            Withdraw proposal
          </button>
        )}
        {current.capabilities.includes("approve") && (
          <button
            type="button"
            class="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => {
              if (confirm("Approve this proposal and convert it to a vote?"))
                void action(() => postJson(`${base}/approve`, {}, groupVoteProposalApproveResponseSchema));
            }}
          >
            Approve and create vote
          </button>
        )}
      </div>
      {current.capabilities.includes("reject") && (
        <form
          class="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void action(() => postJson(`${base}/reject`, { reason }, groupVoteProposalRejectResponseSchema));
          }}
        >
          <label class="form-label" for={`proposal-${current.id}-rejection-reason`}>
            Rejection reason
          </label>
          <textarea
            id={`proposal-${current.id}-rejection-reason`}
            class="form-control"
            rows={2}
            maxLength={1000}
            required
            value={reason}
            disabled={busy}
            onInput={(event) => setReason(event.currentTarget.value)}
          />
          <button type="submit" class="btn btn-sm btn-danger mt-2" disabled={busy || !reason.trim()}>
            Reject proposal
          </button>
        </form>
      )}
    </div>
  );
}

export function GroupVoteProposals({ groupId, canParticipate }: { groupId: string; canParticipate: boolean }) {
  const actions = useRef<ApiTableActions | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<GroupVoteProposal | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function reload(): Promise<void> {
    setSelectedProposal(null);
    await actions.current?.reload();
  }

  return (
    <div>
      {canParticipate && (
        <div class="mb-3">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            aria-expanded={showCreate}
            onClick={() => setShowCreate((shown) => !shown)}
          >
            {showCreate ? "Hide proposal form" : "Propose a vote"}
          </button>
        </div>
      )}
      {showCreate && <GroupVoteProposalForm groupId={groupId} onCreated={reload} />}
      <ApiDataTable
        actionsRef={actions}
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals`}
        responseSchema={groupVoteProposalsListResponseSchema}
        resolve={(response) => response.proposals}
        resolvePage={(response) => response.page}
        paginate
        searchPlaceholder="Search proposals…"
        initialSort="-created_at"
        columns={[
          {
            header: "Proposal",
            cell: (proposal) => (
              <div>
                <div class="fw-semibold">{proposal.title}</div>
                <div class="small text-muted">{proposal.description}</div>
              </div>
            ),
            sort: { asc: "title", desc: "-title" },
          },
          {
            header: "Status",
            cell: (proposal) => <Badge status={proposal.status} />,
            sort: { asc: "status", desc: "-status" },
          },
          {
            header: "Endorsements",
            cell: (proposal) => `${proposal.endorsementCount} / ${proposal.minEndorsersRequired}`,
            sort: { asc: "endorsement_count", desc: "-endorsement_count" },
          },
          {
            header: "Created",
            cell: (proposal) => fmt(proposal.createdAt),
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            header: "",
            className: "text-end",
            cell: (proposal) => (
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                aria-expanded={selectedProposal?.id === proposal.id}
                onClick={() => setSelectedProposal((current) => (current?.id === proposal.id ? null : proposal))}
              >
                {selectedProposal?.id === proposal.id ? "Hide" : "Details"}
              </button>
            ),
          },
        ]}
        empty="No vote proposals are available through this group."
        rowKey={(proposal) => proposal.id}
        detailRow={(proposal) =>
          selectedProposal?.id === proposal.id ? (
            <div class="p-3 bg-body-tertiary">
              <GroupVoteProposalDetail groupId={groupId} proposal={selectedProposal} onChanged={reload} />
            </div>
          ) : null
        }
      />
    </div>
  );
}
