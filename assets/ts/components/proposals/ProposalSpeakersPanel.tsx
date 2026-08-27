import { useEffect, useState } from "preact/hooks";
import { proposalSpeakersResponseSchema, type ProposalSpeaker } from "../../../shared/schemas/proposal-speakers";
import { useData } from "../../hooks/useData";
import { getJson } from "../../shared/api-client";
import { formatDateTime, type ToastType } from "../../shared/ui";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
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
}: {
  endpoint: string;
  proposalId: string;
  access: { canReview: boolean; canFinalize: boolean };
  proposal: { proposer_user_id: string; status: string; decision_status?: string | null; proposal_type: string };
  sessionTypes?: Array<{ label: string; requiresPresentation: boolean }>;
  onReload?: () => void | Promise<void>;
  notify?: (message: string, type: ToastType) => void;
  endpoints: ProposalSpeakerEndpointConfig;
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
    <section class="card" aria-label="Proposal speakers">
      <div class="card-header d-flex align-items-center gap-2">
        <h6 class="mb-0">Speakers</h6>
        <span class="small text-muted">{speakers.length} assigned</span>
        <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void roster.reload()}>
          ↺ Refresh
        </button>
      </div>
      <div class="card-body">
        {speakers.length === 0 ? (
          <p class="text-muted fst-italic mb-0">No speakers assigned yet.</p>
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
          <div class="small text-muted">
            Presentation deadline: {formatDateTime(roster.data.proposal.presentationDeadline)}
          </div>
        )}
      </div>
    </section>
  );
}
