import { usePortalHashLocation } from "../../hash-location";
import { useId, useRef, useState } from "preact/hooks";
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
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { deleteJson, getJson, postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Textarea } from "../../../../ui/TextControl";
import { fmtDate } from "../../ui";

function GroupVoteProposalDetail({
  groupId,
  proposal,
  onChanged,
}: {
  groupId: string;
  proposal: GroupVoteProposal;
  onChanged: () => Promise<void>;
}) {
  const headingId = useId();
  const [, navigate] = usePortalHashLocation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals/${encodeURIComponent(proposal.id)}`;
  const detail = useData(() => getJson(base, groupVoteProposalDetailResponseSchema), [base]);

  async function action<T>(request: () => Promise<T>, onCompleted?: (result: T) => void): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await request();
      await onChanged();
      onCompleted?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update the proposal."));
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) return <Spinner label="Loading proposal details…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  const current = detail.data?.proposal ?? proposal;

  async function withdraw(): Promise<void> {
    if (
      !(await confirmAction({
        title: `Withdraw "${current.title}"?`,
        body: "The proposal is removed from consideration and endorsers are notified.",
        consequences: [
          "Endorsements already collected are discarded",
          "You can submit a new proposal later if you change your mind",
        ],
        confirmLabel: "Withdraw proposal",
      }))
    )
      return;
    await action(() => deleteJson(base, groupVoteProposalMutationResponseSchema));
  }

  async function approve(): Promise<void> {
    if (
      !(await confirmAction({
        title: `Approve "${current.title}" and create a vote?`,
        body: "This creates a vote using the proposal's opening and closing times.",
        consequences: [
          "A new vote is created using this proposal's settings",
          "The proposal can no longer be withdrawn or rejected",
        ],
        confirmLabel: "Approve and create vote",
        tone: "primary",
      }))
    )
      return;
    await action(
      () => postJson(`${base}/approve`, {}, groupVoteProposalApproveResponseSchema),
      ({ convertedVote }) =>
        navigate(`/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(convertedVote.id)}`),
    );
  }

  return (
    <Panel class="pk" aria-labelledby={headingId}>
      <PanelHeader id={headingId} title={current.title} />
      <PanelBody class="pk-stack">
        <p>{current.description}</p>
        <p class="pk-small">
          {current.endorsementCount} of {current.minEndorsersRequired} required endorsements
        </p>
        {/* The reason is titled rather than left as red text: a tone that is
            the only thing saying "rejected" says nothing to a reader who
            cannot separate it from the surrounding ink. */}
        {current.rejectionReason && (
          <Alert tone="danger" title="Rejected">
            {current.rejectionReason}
          </Alert>
        )}
        <ErrorAlert error={error} />
        <div class="pk-cluster">
          {current.capabilities.includes("endorse") && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() =>
                void action(
                  () => postJson(`${base}/endorsement`, {}, groupVoteProposalEndorseResponseSchema),
                  ({ convertedVote }) => {
                    if (convertedVote)
                      navigate(`/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(convertedVote.id)}`);
                  },
                )
              }
            >
              Endorse
            </Button>
          )}
          {current.capabilities.includes("withdraw_endorsement") && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(() => deleteJson(`${base}/endorsement`, groupVoteProposalMutationResponseSchema))
              }
            >
              Withdraw endorsement
            </Button>
          )}
          {current.capabilities.includes("withdraw") && (
            <Button size="sm" variant="danger-quiet" disabled={busy} onClick={() => void withdraw()}>
              Withdraw proposal
            </Button>
          )}
          {current.capabilities.includes("approve") && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void approve()}>
              Approve and create vote
            </Button>
          )}
        </div>
        {current.capabilities.includes("reject") && (
          <form
            class="pk-stack pk-stack--snug"
            aria-label={`Reject ${current.title}`}
            onSubmit={(event) => {
              event.preventDefault();
              void action(() => postJson(`${base}/reject`, { reason }, groupVoteProposalRejectResponseSchema));
            }}
          >
            <fieldset class="pk-fieldset" disabled={busy}>
              <Field label="Rejection reason" required help="Sent to the proposer with the decision.">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={2}
                    maxLength={1000}
                    value={reason}
                    onInput={(event) => setReason(event.currentTarget.value)}
                  />
                )}
              </Field>
            </fieldset>
            <div class="pk-cluster">
              <Button type="submit" variant="danger" size="sm" disabled={busy || !reason.trim()}>
                Reject proposal
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}

export function GroupVoteProposals({
  groupId,
  canParticipate,
  onPropose,
}: {
  groupId: string;
  canParticipate: boolean;
  /** Proposing is a page of its own; this is where the list sends the reader. */
  onPropose: () => void;
}) {
  const actions = useRef<ApiTableActions | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<GroupVoteProposal | null>(null);

  async function reload(): Promise<void> {
    setSelectedProposal(null);
    await actions.current?.reload();
  }

  return (
    <div class="pk pk-stack">
      {!canParticipate && (
        <Alert tone="info">
          You are not participating in this group, so you cannot propose a vote. Leadership can create a vote outright
          under All votes.
        </Alert>
      )}
      <ApiDataTable
        caption="Vote proposals"
        actionsRef={actions}
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals`}
        responseSchema={groupVoteProposalsListResponseSchema}
        resolve={(response) => response.proposals}
        resolvePage={(response) => response.page}
        paginate
        searchPlaceholder="Search proposals…"
        initialSort="-created_at"
        createAction={canParticipate ? { label: "Propose a vote", onSelect: onPropose } : undefined}
        columns={[
          {
            header: "Proposal",
            cell: (proposal) => (
              <div class="pk-stack pk-stack--tight">
                <span class="pk-strong">{proposal.title}</span>
                <span class="pk-small">{proposal.description}</span>
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
            // Counts and dates have a bounded length; the columns say so
            // instead of wearing `pk-nowrap` while still claiming slack.
            header: "Endorsements",
            width: "fit",
            cell: (proposal) => `${proposal.endorsementCount} / ${proposal.minEndorsersRequired}`,
            sort: { asc: "endorsement_count", desc: "-endorsement_count" },
          },
          {
            header: "Created",
            width: "fit",
            cell: (proposal) => fmtDate(proposal.createdAt),
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
        ]}
        empty={
          canParticipate ? (
            // "Propose a vote" is already above this state, as the form's
            // disclosure; a second button under that name would be one
            // command answering to two controls.
            <EmptyState
              title="No proposals yet"
              body="A proposal is a participant's request for a vote. Reaching the required endorsements creates a vote automatically; leadership can also approve a proposal directly."
            />
          ) : (
            /*
             * Saying why, not only that there is nothing (#52).
             *
             * "No vote proposals are available through this group" with no
             * command beside it reads as a feature that does not work. A
             * proposal comes from somebody participating in the group; a
             * reader who manages the group without participating in it can
             * still create a vote outright, and should be told that rather
             * than left to conclude proposals are broken.
             */
            <EmptyState
              title="No proposals yet"
              body="A proposal is a participant's request for a vote. Reaching the required endorsements creates a vote automatically; leadership can also approve a proposal directly."
            />
          )
        }
        rowKey={(proposal) => proposal.id}
        // Activating a row opens its detail in place — the same rule as
        // every other list. The "Details" button column this replaces left
        // the row itself inert.
        rowAction={(proposal) => ({
          label:
            selectedProposal?.id === proposal.id
              ? `Hide details for ${proposal.title}`
              : `Show details for ${proposal.title}`,
          onSelect: () => setSelectedProposal((current) => (current?.id === proposal.id ? null : proposal)),
        })}
        detailRow={(proposal) =>
          selectedProposal?.id === proposal.id ? (
            <GroupVoteProposalDetail groupId={groupId} proposal={selectedProposal} onChanged={reload} />
          ) : null
        }
      />
    </div>
  );
}
