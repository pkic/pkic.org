import {
  registrationSessionsResponseSchema,
  type RegistrationSessionsQuery,
  type RegistrationSessionsResponse,
} from "../../../../assets/shared/schemas/event-registration-sessions";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { batchFirst, buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { eventContactAccessSql } from "../event-participation/evidence-retention";
import { publishedRoomsSql, publishedSessionsSql } from "../event-participation/published-schedule";

/** The caller supplies the canonical live event-management guarded database. */
export async function listRegistrationSessionIntent(
  db: DatabaseLike,
  eventId: string,
  registrationId: string,
  query: RegistrationSessionsQuery,
): Promise<RegistrationSessionsResponse> {
  const contactAccess = eventContactAccessSql("registration.event_id");
  const ownerFrom = `FROM registrations registration JOIN users person ON person.id=registration.user_id`;
  const readableOwner = "person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL";
  const results = await db.batch([
    db
      .prepare(
        `SELECT ${contactAccess} AS contactAvailable, (${readableOwner}) AS ownerAvailable
         ${ownerFrom} WHERE registration.event_id=? AND registration.id=?`,
      )
      .bind(eventId, registrationId),
    ...buildOffsetPageStatements(db, {
      source: {
        selectSql: `SELECT session.id,session.published_revision AS publishedRevision,session.title,
          session.timezone AS timeZone,session.start_at AS startAt,session.end_at AS endAt,
          session.visibility,session.admission_policy AS admissionPolicy,participation.room_id AS roomId,
          participation.saved,participation.status,participation.attendance_mode AS attendanceMode,
          participation.created_at AS createdAt,participation.updated_at AS updatedAt,
          (SELECT json_group_array(json_object('id',location.id,'name',location.name))
            FROM (${publishedRoomsSql}) location WHERE location.event_id=session.event_id
            AND (location.id=session.room_id OR EXISTS(
              SELECT 1 FROM json_each(session.additional_room_ids_json) selected WHERE selected.value=location.id
            ))) AS roomsJson`,
        fromSql: `${ownerFrom}
          JOIN agenda_session_participations participation
            ON participation.event_id=registration.event_id AND participation.user_id=registration.user_id
          JOIN (${publishedSessionsSql}) session
            ON session.event_id=participation.event_id AND session.id=participation.occurrence_id
          WHERE registration.event_id=? AND registration.id=? AND ${readableOwner} AND ${contactAccess}
            AND INSTR(LOWER(session.title),LOWER(?))>0
            AND (? IS NULL OR participation.status=?) AND (? IS NULL OR participation.saved=?)`,
        bindings: [
          eventId,
          registrationId,
          query.q ?? "",
          query.status ?? null,
          query.status ?? null,
          query.saved === undefined ? null : Number(query.saved),
          query.saved === undefined ? null : Number(query.saved),
        ],
      },
      orderBy: resolveMappedOrderBy(
        query.sort,
        { title: "session.title", startAt: "session.start_at" },
        "session.start_at ASC",
        "session.id ASC",
      ),
      limit: query.limit,
      offset: query.offset,
    }),
  ]);
  const owner = batchFirst<{ contactAvailable: number; ownerAvailable: number }>(results[0]!);
  if (!owner || !owner.ownerAvailable) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration unavailable.");
  if (!owner.contactAvailable)
    throw new AppError(410, "EVENT_CONTACT_RETENTION_EXPIRED", "Contact access for this event has expired.");
  const { rows, total } = decodeOffsetPageResults<Record<string, unknown>>(results[1]!, results[2]!);
  return registrationSessionsResponseSchema.parse({
    sessions: rows.map(({ roomsJson, ...row }) => ({
      ...row,
      saved: Boolean(row.saved),
      rooms: JSON.parse(String(roomsJson)),
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
