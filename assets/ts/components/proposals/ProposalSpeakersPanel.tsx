/**
 * The proposal's speaker roster: one card per speaker, and — for an operator —
 * the way to the page that invites another.
 *
 * Inviting is a page under this facet rather than a form standing open above
 * the cards: a create action is never loaded inline, and a reader who opens
 * the roster to look at it should not be handed a form.
 */
import { useEffect, useState } from "preact/hooks";
import { proposalSpeakersResponseSchema, type ProposalRosterSpeaker } from "../../../shared/schemas/proposal-speakers";
import { useData } from "../../hooks/useData";
import { getJson } from "../../shared/api-client";
import { formatDateTime, type ToastType } from "../../shared/ui";
import { formatNumber } from "../../../shared/format-number";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import { ButtonLink } from "../../ui/Button";
import { SectionHeading } from "../../ui/SectionHeading";
import {
  NO_PROFILE_ACCESS,
  ProposalSpeakerCard,
  buildReplacementProposerOptions,
  type ProposalSpeakerEndpointConfig,
  type ProposalSpeakerProfileAccess,
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
  userHref,
  identityHref,
  registrationHref,
  profileAccess = NO_PROFILE_ACCESS,
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
  /** Where a speaker's user record opens; undefined when the viewer may not open user records. */
  userHref?: (userId: string) => string | undefined;
  /** Where a speaker's identities open; undefined when the viewer may not open them. */
  identityHref?: (userId: string) => string | undefined;
  /** What the viewer may change about the people on the roster. */
  profileAccess?: ProposalSpeakerProfileAccess;
  /** Where a speaker's registration for this event opens; undefined when the viewer may not manage registrations. */
  registrationHref?: (registrationId: string) => string | undefined;
}) {
  const [speakerOverrides, setSpeakerOverrides] = useState<Record<string, Partial<ProposalRosterSpeaker>>>({});
  const roster = useData(() => getJson(`${endpoint}/speakers`, proposalSpeakersResponseSchema), [endpoint, refreshKey]);
  useEffect(() => setSpeakerOverrides({}), [endpoint, refreshKey]);
  if (roster.loading) return <Spinner />;
  if (roster.error) return <ErrorAlert error={roster.error} />;
  if (!roster.data) return null;
  const speakers = roster.data.speakers.map((speaker) => ({ ...speaker, ...speakerOverrides[speaker.userId] }));
  const requiresPresentation =
    sessionTypes?.find((type) => type.label.toLowerCase() === proposal.proposal_type.toLowerCase())
      ?.requiresPresentation ?? false;

  function updateSpeaker(userId: string, patch: Partial<ProposalRosterSpeaker>) {
    setSpeakerOverrides((previous) => ({ ...previous, [userId]: { ...previous[userId], ...patch } }));
  }

  return (
    <div class="pk">
      <section aria-label="Proposal speakers" class="pk-stack">
        <div class="pk-cluster pk-cluster--between">
          {/* The count belongs to the heading it counts, not halfway to the button. */}
          <span class="pk-cluster">
            <SectionHeading level={4}>Speakers</SectionHeading>
            <span class="pk-small pk-muted pk-nowrap">
              {formatNumber(speakers.length)} {speakers.length === 1 ? "speaker" : "speakers"}
            </span>
          </span>
          {access.canFinalize && invitePath && (
            <ButtonLink variant="primary" href={invitePath}>
              Invite co-speaker
            </ButtonLink>
          )}
        </div>
        <div class="pk-stack pk-stack--snug">
          {speakers.length === 0 ? (
            <EmptyState
              title="No speakers assigned yet"
              body="Speakers appear here once the proposer adds them or a co-speaker accepts an invitation."
            />
          ) : (
            <div class="pk-speaker-portrait-grid">
              {speakers.map((speaker) => (
                <ProposalSpeakerCard
                  key={speaker.userId}
                  speaker={speaker}
                  identityId={speaker.identityId}
                  registration={speaker.registration}
                  userHref={userHref?.(speaker.userId)}
                  identityHref={speaker.identityId ? identityHref?.(speaker.userId) : undefined}
                  registrationHref={speaker.registration ? registrationHref?.(speaker.registration.id) : undefined}
                  independentCapacity={speaker.independentCapacity}
                  onIndependentCapacityReviewed={(review) =>
                    updateSpeaker(speaker.userId, { independentCapacity: review })
                  }
                  proposalId={proposalId}
                  profileAccess={profileAccess}
                  canFinalize={access.canFinalize}
                  decisionStatus={proposal.decision_status}
                  requiresPresentation={requiresPresentation}
                  isCurrentProposer={speaker.userId === proposal.proposer_user_id}
                  replacementSpeakers={buildReplacementProposerOptions(speakers, speaker.userId)}
                  endpoints={endpoints}
                  notify={notify}
                  onSaved={updateSpeaker}
                  onProfileChanged={() => void roster.reload()}
                  onRemoved={() => {
                    void roster.reload();
                    void onReload?.();
                  }}
                />
              ))}
            </div>
          )}
          {roster.data.proposal.presentationDeadline && (
            <p class="pk-small">Presentation deadline: {formatDateTime(roster.data.proposal.presentationDeadline)}</p>
          )}
        </div>
      </section>
    </div>
  );
}
