/**
 * The proposal's speaker roster: one card per speaker, and — for an operator —
 * the way to the page that invites another.
 *
 * Inviting is a page under this facet rather than a form standing open above
 * the cards: a create action is never loaded inline, and a reader who opens
 * the roster to look at it should not be handed a form.
 */
import { useEffect, useState } from "preact/hooks";
import { proposalSpeakersResponseSchema, type ProposalSpeaker } from "../../../shared/schemas/proposal-speakers";
import { useData } from "../../hooks/useData";
import { getJson } from "../../shared/api-client";
import { formatDateTime, type ToastType } from "../../shared/ui";
import { EmptyState } from "../EmptyState";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import { ButtonLink } from "../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import {
  ProposalSpeakerCard,
  buildReplacementProposerOptions,
  type ProposalSpeakerEndpointConfig,
} from "./ProposalSpeakerCard";

export function ProposalSpeakersPanel({
  endpoint,
  proposalId,
  access,
  proposal,
  sessionTypes,
  onReload,
  notify,
  endpoints,
  invitePath,
  refreshKey,
}: {
  endpoint: string;
  proposalId: string;
  access: { canReview: boolean; canFinalize: boolean };
  proposal: { proposer_user_id: string; status: string; decision_status?: string | null; proposal_type: string };
  sessionTypes?: Array<{ label: string; requiresPresentation: boolean }>;
  onReload?: () => void | Promise<void>;
  notify?: (message: string, type: ToastType) => void;
  endpoints: ProposalSpeakerEndpointConfig;
  /** Where an operator invites a co-speaker; absent when the caller cannot route it or the reader may not. */
  invitePath?: string;
  /** Changes when something outside the panel altered the roster, so it reads again. */
  refreshKey?: string | number;
}) {
  const [speakerOverrides, setSpeakerOverrides] = useState<Record<string, Partial<ProposalSpeaker>>>({});
  const roster = useData(() => getJson(`${endpoint}/speakers`, proposalSpeakersResponseSchema), [endpoint, refreshKey]);
  useEffect(() => setSpeakerOverrides({}), [endpoint, refreshKey]);
  if (roster.loading) return <Spinner />;
  if (roster.error) return <ErrorAlert error={roster.error} />;
  if (!roster.data) return null;
  const speakers = roster.data.speakers.map((speaker) => ({ ...speaker, ...speakerOverrides[speaker.userId] }));
  const requiresPresentation =
    sessionTypes?.find((type) => type.label.toLowerCase() === proposal.proposal_type.toLowerCase())
      ?.requiresPresentation ?? false;

  function updateSpeaker(userId: string, patch: Partial<ProposalSpeaker>) {
    setSpeakerOverrides((previous) => ({ ...previous, [userId]: { ...previous[userId], ...patch } }));
  }

  return (
    <div class="pk">
      <Panel aria-label="Proposal speakers">
        <PanelHeader title="Speakers" headingLevel={4}>
          <span class="pk-small pk-muted pk-nowrap">
            {speakers.length} {speakers.length === 1 ? "speaker" : "speakers"}
          </span>
          {access.canFinalize && invitePath && (
            <ButtonLink size="sm" variant="primary" href={invitePath}>
              Invite co-speaker
            </ButtonLink>
          )}
        </PanelHeader>
        <PanelBody class="pk-stack pk-stack--snug">
          {speakers.length === 0 ? (
            <EmptyState
              title="No speakers assigned yet"
              body="Speakers appear here once the proposer adds them or a co-speaker accepts an invitation."
            />
          ) : (
            speakers.map((speaker) => (
              <ProposalSpeakerCard
                key={speaker.userId}
                speaker={speaker}
                proposalId={proposalId}
                canEdit={access.canFinalize}
                canFinalize={access.canFinalize}
                decisionStatus={proposal.decision_status}
                requiresPresentation={requiresPresentation}
                isCurrentProposer={speaker.userId === proposal.proposer_user_id}
                replacementSpeakers={buildReplacementProposerOptions(speakers, speaker.userId)}
                endpoints={endpoints}
                notify={notify}
                onSaved={updateSpeaker}
                onRemoved={() => {
                  void roster.reload();
                  void onReload?.();
                }}
              />
            ))
          )}
          {roster.data.proposal.presentationDeadline && (
            <p class="pk-small">Presentation deadline: {formatDateTime(roster.data.proposal.presentationDeadline)}</p>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
