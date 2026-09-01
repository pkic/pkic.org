import { useEffect, useState } from "preact/hooks";
import { proposalSpeakersResponseSchema, type ProposalSpeaker } from "../../../shared/schemas/proposal-speakers";
import { useData } from "../../hooks/useData";
import { getJson } from "../../shared/api-client";
import { formatDateTime, type ToastType } from "../../shared/ui";
import { EmptyState } from "../EmptyState";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import { Button } from "../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import {
  ProposalSpeakerCard,
  buildReplacementProposerOptions,
  type ProposalSpeakerEndpointConfig,
} from "./ProposalSpeakerCard";
import { ProposalCoSpeakerInviteForm } from "./ProposalCoSpeakerInviteForm";
import type { EventInviteWindow } from "../../../shared/schemas/event-invite-validity";

export function ProposalSpeakersPanel({
  endpoint,
  proposalId,
  access,
  proposal,
  sessionTypes,
  onReload,
  notify,
  endpoints,
  inviteEndpoint,
  inviteWindow,
}: {
  endpoint: string;
  proposalId: string;
  access: { canReview: boolean; canFinalize: boolean };
  proposal: { proposer_user_id: string; status: string; decision_status?: string | null; proposal_type: string };
  sessionTypes?: Array<{ label: string; requiresPresentation: boolean }>;
  onReload?: () => void | Promise<void>;
  notify?: (message: string, type: ToastType) => void;
  endpoints: ProposalSpeakerEndpointConfig;
  inviteEndpoint?: string;
  inviteWindow?: EventInviteWindow;
}) {
  const [speakerOverrides, setSpeakerOverrides] = useState<Record<string, Partial<ProposalSpeaker>>>({});
  const roster = useData(() => getJson(`${endpoint}/speakers`, proposalSpeakersResponseSchema), [endpoint]);
  useEffect(() => setSpeakerOverrides({}), [endpoint]);
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
          <span class="pk-small pk-nowrap">{speakers.length} assigned</span>
          <Button size="sm" onClick={() => void roster.reload()}>
            ↺ Refresh
          </Button>
        </PanelHeader>
        <PanelBody class="pk-stack pk-stack--snug">
          {access.canFinalize && inviteEndpoint && inviteWindow && (
            <ProposalCoSpeakerInviteForm
              endpoint={inviteEndpoint}
              proposalId={proposalId}
              event={inviteWindow}
              notify={notify}
              onInvited={async () => {
                await roster.reload();
                await onReload?.();
              }}
            />
          )}
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
