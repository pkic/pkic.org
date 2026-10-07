import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaCreditRoleSchema } from "../../../../../../../shared/schemas/event-agenda";
import { agendaSessionContent } from "../../../../../../../shared/public-agenda-content";
import { AgendaSpeaker } from "../../../../../../site/AgendaSpeaker";
import { Button } from "../../../../../../ui/Button";
import { Select } from "../../../../../../ui/TextControl";

function SessionSpeakerSummary({
  snapshot,
  occurrence,
  speaker,
}: {
  snapshot: AgendaSnapshot;
  occurrence?: AgendaOccurrence;
  speaker: AgendaOccurrence["speakers"][number];
}) {
  if (!occurrence) return <strong>{speaker.displayName}</strong>;
  const history = occurrence.history;
  const content = agendaSessionContent(
    snapshot,
    {
      ...occurrence,
      speakers: [speaker],
      history: history
        ? {
            ...history,
            appearances: history.appearances.filter((item) => item.userId === speaker.userId),
            archivalCredits: [],
            proposalRepresentations: history.proposalRepresentations.filter((item) => item.userId === speaker.userId),
          }
        : undefined,
    },
    true,
  );
  return (
    <>
      {content.speakers[0] && <AgendaSpeaker speaker={content.speakers[0]} detail />}
      <small>
        {history?.appearances.some((item) => item.userId === speaker.userId)
          ? "Event representation approved"
          : "Event representation needs review"}
      </small>
    </>
  );
}

export function SessionSpeakerFields({
  snapshot,
  occurrence,
  speakers,
  setSpeakers,
  roomId,
  additionalRoomIds,
  onReview,
}: {
  snapshot: AgendaSnapshot;
  occurrence?: AgendaOccurrence;
  speakers: AgendaOccurrence["speakers"];
  setSpeakers: (speakers: AgendaOccurrence["speakers"]) => void;
  roomId: string;
  additionalRoomIds: string[];
  onReview: (speaker: AgendaOccurrence["speakers"][number]) => void;
}) {
  return (
    <div class="pk-cluster">
      {speakers.map((speaker) => (
        <div class="pk-stack" key={speaker.userId}>
          <SessionSpeakerSummary snapshot={snapshot} occurrence={occurrence} speaker={speaker} />
          <Button
            size="sm"
            disabled={!occurrence?.speakers.some((item) => item.userId === speaker.userId)}
            onClick={() => onReview(speaker)}
          >
            Speaker details
          </Button>
          {!occurrence?.speakers.some((item) => item.userId === speaker.userId) && (
            <small>Save the session to review this speaker’s representation.</small>
          )}
          <Button
            size="sm"
            aria-label={`Remove speaker ${speaker.displayName}`}
            onClick={() => setSpeakers(speakers.filter((value) => value.userId !== speaker.userId))}
          >
            {speaker.displayName} ×
          </Button>
          <Select
            aria-label={`Credit for ${speaker.displayName}`}
            value={speaker.role ?? "speaker"}
            onChange={(event) =>
              setSpeakers(
                speakers.map((value) =>
                  value.userId === speaker.userId
                    ? { ...value, role: agendaCreditRoleSchema.parse(event.currentTarget.value) }
                    : value,
                ),
              )
            }
          >
            {agendaCreditRoleSchema.options.map((role) => (
              <option value={role}>{role.replaceAll("_", " ")}</option>
            ))}
          </Select>
          <Select
            aria-label={`Attendance for ${speaker.displayName}`}
            value={speaker.attendanceMode ?? "physical"}
            onChange={(event) =>
              setSpeakers(
                speakers.map((value) =>
                  value.userId === speaker.userId
                    ? {
                        ...value,
                        attendanceMode: event.currentTarget.value === "remote" ? "remote" : "physical",
                        roomId: null,
                      }
                    : value,
                ),
              )
            }
          >
            <option value="physical">In person</option>
            <option value="remote">Remote</option>
          </Select>
          {(speaker.attendanceMode ?? "physical") === "physical" && (
            <Select
              aria-label={`Location for ${speaker.displayName}`}
              value={speaker.roomId ?? ""}
              onChange={(event) =>
                setSpeakers(
                  speakers.map((value) =>
                    value.userId === speaker.userId ? { ...value, roomId: event.currentTarget.value || null } : value,
                  ),
                )
              }
            >
              <option value="">{additionalRoomIds.length ? "Choose one location" : "Follow session location"}</option>
              {snapshot.rooms
                .filter((room) => room.id === roomId || additionalRoomIds.includes(room.id))
                .map((room) => (
                  <option value={room.id}>{room.name}</option>
                ))}
            </Select>
          )}
        </div>
      ))}
    </div>
  );
}
