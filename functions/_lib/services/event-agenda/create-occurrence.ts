import type { z } from "zod";
import type { agendaOccurrenceCreateSchema } from "../../../../assets/shared/schemas/event-agenda";
import { agendaScheduleConflictProposalSchema } from "../../../../assets/shared/schemas/event-agenda-schedule";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import type { EventReadSelection } from "../events/selection";
import { readEventAdminResource } from "../events/authorized-context";
import { agendaWriteDatabase } from "./command-authorization";
import { prepareAgendaRead } from "./read";
import { agendaSessionFormatLabels, canonicalAgendaSessionFormats } from "./occurrence-formats";
import { prepareAgendaOccurrenceSettingsRead } from "./occurrence-settings";
import { prepareAgendaOccurrenceInsert } from "./occurrence-insert";
import { agendaAdditionalRoomStatements } from "./occurrence-rooms";
import { agendaSpeakerStatements } from "./occurrence-speakers";
import { validateAgendaSchedule } from "./schedule-validation";
import { commitAgendaSnapshot } from "./commit-snapshot";

type OccurrenceInput = z.infer<typeof agendaOccurrenceCreateSchema>;

function prepareOccurrenceCreation(
  db: DatabaseLike,
  event: EventReadSelection,
  eventSlug: string,
  requested: OccurrenceInput,
) {
  const id = crypto.randomUUID();
  const read = prepareAgendaRead(db, event, eventSlug);
  const settings = prepareAgendaOccurrenceSettingsRead(db, event, [{ ...requested, id }]);
  return {
    statements: [...read.statements, ...settings.statements],
    decode(loaded: D1StatementResult[], eventId: string) {
      const { snapshot, event } = read.decodeWithEvent(loaded.slice(0, read.statements.length));
      const [input] = canonicalAgendaSessionFormats(agendaSessionFormatLabels(event.settings_json), [requested]);
      const candidate = {
        ...input,
        id,
        speakers: input.speakerUserIds.map((userId) => ({
          userId,
          displayName: "",
          ...input.speakerPlacements?.[userId],
          role: input.speakerRoles?.[userId],
        })),
      };
      const conflictProposal = agendaScheduleConflictProposalSchema.parse({
        timeZone: snapshot.timeZone,
        occurrences: [candidate],
      });
      validateAgendaSchedule(snapshot, [...snapshot.occurrences, candidate], conflictProposal);
      return {
        id,
        input,
        conflictProposal,
        settings: settings.decode(loaded.slice(read.statements.length), {
          id: eventId,
          settings_json: event.settings_json,
        }),
      };
    },
  };
}

export async function createAgendaOccurrence(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  requested: OccurrenceInput,
  actorUserId: string | null = null,
) {
  const read = prepareOccurrenceCreation(db, eventId, eventSlug, requested);
  return commitOccurrenceCreation(
    db,
    eventId,
    eventSlug,
    read.decode(await db.batch(read.statements), eventId),
    actorUserId,
  );
}

export async function createAgendaOccurrenceRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  requested: OccurrenceInput,
) {
  return readEventAdminResource(db, request, env, eventSlug, "agenda:write", (event) => {
    const read = prepareOccurrenceCreation(db, event, eventSlug, requested);
    return {
      statements: read.statements,
      decode(loaded, event, actor) {
        return commitOccurrenceCreation(
          agendaWriteDatabase(db, actor, event.id),
          event.id,
          eventSlug,
          read.decode(loaded, event.id),
          actor.id,
        );
      },
    };
  });
}

function commitOccurrenceCreation(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  plan: ReturnType<ReturnType<typeof prepareOccurrenceCreation>["decode"]>,
  actorUserId: string | null,
) {
  const { id, input, conflictProposal } = plan;
  return commitAgendaSnapshot(
    db,
    eventId,
    eventSlug,
    input.expectedRevision,
    [
      prepareAgendaOccurrenceInsert(db, eventId, id, input),
      ...agendaAdditionalRoomStatements(db, id, input.additionalRoomIds ?? []),
      ...agendaSpeakerStatements(db, id, input.speakerUserIds, input.speakerRoles, input.speakerPlacements),
      ...plan.settings,
    ],
    actorUserId,
    conflictProposal,
  );
}
