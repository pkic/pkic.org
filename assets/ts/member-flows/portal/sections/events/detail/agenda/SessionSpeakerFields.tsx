import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { agendaCreditRoleSchema } from "../../../../../../../shared/schemas/event-agenda";
import { SPEAKER_ROLE_OPTIONS } from "../../../../../../shared/speaker-roles";
import { AffiliationRow } from "../../../../../../ui/AffiliationRow";
import { Avatar } from "../../../../../../ui/Avatar";
import { RowActions } from "../../../../../../ui/RowActions";
import { Select } from "../../../../../../ui/TextControl";

/**
 * The session's speakers as one compact row each: portrait, name, one quiet organization line,
 * a small credit-role choice, and a remove control. Speaker details live outside the session
 * editor; each speaker's saved placement travels unchanged in the session state.
 */
export function SessionSpeakerFields({
  speakers,
  setSpeakers,
}: {
  occurrence?: AgendaOccurrence;
  speakers: AgendaOccurrence["speakers"];
  setSpeakers: (speakers: AgendaOccurrence["speakers"]) => void;
}) {
  if (!speakers.length) return null;
  function move(index: number, target: number) {
    if (target < 0 || target >= speakers.length) return;
    const ordered = [...speakers];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    setSpeakers(ordered);
  }
  return (
    <div class="pk-agenda-editor__speakers">
      {speakers.map((speaker, index) => {
        const live = speaker.profileCandidate;
        const terms = (speaker.profileCandidates ?? (live ? [live] : []))
          .flatMap((candidate) => [candidate.organizationName, candidate.jobTitle])
          .filter((term): term is string => Boolean(term));
        return (
          <AffiliationRow
            key={speaker.userId}
            media={
              <Avatar name={speaker.displayName} src={speaker.profileCandidate?.photoUrl ?? undefined} size="sm" />
            }
            title={speaker.displayName}
            terms={terms}
            actions={
              <>
                <Select
                  class="pk-agenda-editor__speaker-role"
                  aria-label={`Role for ${speaker.displayName}`}
                  value={speaker.role ?? "speaker"}
                  onChange={(event) => {
                    const role = agendaCreditRoleSchema.parse(event.currentTarget.value);
                    setSpeakers(
                      speakers.map((value) => (value.userId === speaker.userId ? { ...value, role } : value)),
                    );
                  }}
                >
                  {SPEAKER_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <RowActions
                  subject={speaker.displayName}
                  actions={[
                    { id: "move-up", label: "Move up", disabled: index === 0, onSelect: () => move(index, index - 1) },
                    {
                      id: "move-down",
                      label: "Move down",
                      disabled: index === speakers.length - 1,
                      onSelect: () => move(index, index + 1),
                    },
                    ...(speaker.profileCandidates?.length && speaker.profileCandidates.length > 1
                      ? speaker.profileCandidates.map((candidate) => ({
                          id: `remove-identity-${candidate.identityId}`,
                          label: `Remove affiliation: ${candidate.organizationName ?? candidate.jobTitle ?? "Individual"}`,
                          onSelect: () =>
                            setSpeakers(
                              speakers.map((value) => {
                                if (value.userId !== speaker.userId) return value;
                                const profileCandidates = value.profileCandidates!.filter(
                                  (profile) => profile.identityId !== candidate.identityId,
                                );
                                return { ...value, profileCandidates, profileCandidate: profileCandidates[0] };
                              }),
                            ),
                        }))
                      : []),
                    {
                      id: "remove",
                      label: "Remove speaker",
                      danger: true,
                      onSelect: () => setSpeakers(speakers.filter((value) => value.userId !== speaker.userId)),
                    },
                  ]}
                />
              </>
            }
          />
        );
      })}
    </div>
  );
}
