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
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmtDate } from "../../ui";
import { MarkdownEditor } from "../../../../components/markdown-editor/MarkdownInput";
import { Markdown } from "../../../../components/Markdown";

export function GroupVoteProposalDetail({
  groupId,
  proposal,
  onChanged,
  onWithdrawn,
}: {
  groupId: string;
  proposal: GroupVoteProposal;
  onChanged: () => Promise<void>;
  /** The proposal is gone; the page it was on has nothing left to show. */
  onWithdrawn?: () => void;
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
    await action(
      () => deleteJson(base, groupVoteProposalMutationResponseSchema),
      () => onWithdrawn?.(),
    );
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
        <Markdown markdown={current.description} />
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
                  <MarkdownEditor
                    variant="compact"
                    {...control}
                    name="reason"
                    label="Rejection reason"
                    initialValue={reason}
                    onChange={setReason}
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

/**
 * A proposal's own page (#126): the record under the list, never an
 * expansion between the rows. It reads the proposal by id so a copied URL
 * opens what the row did, and its commands are the proposal's own.
 */
export function GroupVoteProposalRecord({
  groupId,
  proposalId,
  listPath,
}: {
  groupId: string;
  proposalId: string;
  /** The proposals list, the way back. */
  listPath: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals/${encodeURIComponent(proposalId)}`;
  const detail = useData(() => getJson(base, groupVoteProposalDetailResponseSchema), [base]);
  const proposal = detail.data?.proposal;

  return (
    <div class="pk pk-stack">
      <PageHeader
        trail={[{ label: "Proposals", href: usePortalHashLocation.hrefs(listPath) }]}
        eyebrow="Vote proposal"
        title={proposal?.title ?? "Proposal"}
        context={proposal ? <Badge status={proposal.status} /> : undefined}
      />
      {detail.loading && !proposal && <Spinner label="Loading the proposal…" />}
      {detail.error && <ErrorAlert error={detail.error} />}
      {proposal && (
        <GroupVoteProposalDetail
          groupId={groupId}
          proposal={proposal}
          onChanged={async () => {
            await detail.reload();
          }}
          onWithdrawn={() => navigate(listPath)}
        />
      )}
    </div>
  );
}

export function GroupVoteProposals({
  groupId,
  canParticipate,
  onPropose,
  recordPath,
}: {
  groupId: string;
  canParticipate: boolean;
  /** Proposing is a page of its own; this is where the list sends the reader. */
  onPropose: () => void;
  /** Where a proposal's own page lives. */
  recordPath: (proposalId: string) => string;
}) {
  const actions = useRef<ApiTableActions | null>(null);

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
        // Activating a row opens the proposal's own page (#126): a record
        // with commands, never an expansion between the rows.
        rowAction={(proposal) => ({
          label: `Open ${proposal.title}`,
          href: usePortalHashLocation.hrefs(recordPath(proposal.id)),
        })}
      />
    </div>
  );
}
