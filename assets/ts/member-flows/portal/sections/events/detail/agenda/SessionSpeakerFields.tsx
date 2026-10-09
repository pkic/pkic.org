import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { agendaCreditRoleSchema } from "../../../../../../../shared/schemas/event-agenda";
import { SPEAKER_ROLE_OPTIONS } from "../../../../../../shared/speaker-roles";
import { AffiliationRow } from "../../../../../../ui/AffiliationRow";
import { Avatar } from "../../../../../../ui/Avatar";
import { Button } from "../../../../../../ui/Button";
import { Select } from "../../../../../../ui/TextControl";
import { IconRemove } from "../../../../../../components/icons";

/**
 * The session's speakers as one compact row each: portrait, name, one quiet organization line,
 * a small credit-role choice, and a remove control. Speaker details live outside the session
 * editor; each speaker's saved placement travels unchanged in the session state.
 */
export function SessionSpeakerFields({
  occurrence,
  speakers,
  setSpeakers,
}: {
  occurrence?: AgendaOccurrence;
  speakers: AgendaOccurrence["speakers"];
  setSpeakers: (speakers: AgendaOccurrence["speakers"]) => void;
}) {
  if (!speakers.length) return null;
  const history = occurrence?.history;
  return (
    <div class="pk-agenda-editor__speakers">
      {speakers.map((speaker) => {
        const appearance = history?.appearances.find((item) => item.userId === speaker.userId);
        const source = history?.proposalRepresentations.find((item) => item.userId === speaker.userId)?.snapshot;
        const terms = (
          appearance ? [appearance.organizationName, appearance.jobTitle] : [source?.organizationName, source?.jobTitle]
        ).filter((term): term is string => Boolean(term));
        return (
          <AffiliationRow
            key={speaker.userId}
            media={
              <Avatar
                name={speaker.displayName}
                src={appearance?.photoUrl ?? speaker.profileCandidate?.photoUrl ?? undefined}
                size="sm"
              />
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
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={`Remove speaker ${speaker.displayName}`}
                  title={`Remove ${speaker.displayName}`}
                  onClick={() => setSpeakers(speakers.filter((value) => value.userId !== speaker.userId))}
                >
                  <IconRemove width="12" height="12" />
                </Button>
              </>
            }
          />
        );
      })}
    </div>
  );
}
