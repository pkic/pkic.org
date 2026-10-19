import { queryPage, type OffsetPageQuery } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import type { DatabaseLike } from "../types";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type { EventProposalSpeaker, EventSpeakersListQuery } from "../../../assets/shared/schemas/event-speakers";
import {
  proposalSpeakerHeadshotColumns,
  proposalSpeakerProfileValueSql,
  proposalSpeakerOrganizationNameSql,
} from "./proposal-speakers";
import { publicUserHeadshotPath } from "./user-headshot";
import { loadRegistrationDayStates } from "./registrations/day-states";

type SpeakerRow = Omit<EventProposalSpeaker, "days" | "headshotUrl"> & {
  registrationId: string | null;
  userId: string;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
};

/** The speaker's portrait for an organizer's list: the person's own headshot at its public address. */
function speakerHeadshotPath(row: SpeakerRow): string | null {
  return row.headshot_r2_key ? publicUserHeadshotPath(row.userId, row.headshot_r2_key) : null;
}

const SPEAKER_FIRST_NAME = proposalSpeakerProfileValueSql("u", "ps", "firstName");
const SPEAKER_LAST_NAME = proposalSpeakerProfileValueSql("u", "ps", "lastName");
const SPEAKER_ORGANIZATION = proposalSpeakerOrganizationNameSql("ps");
const SPEAKER_FULL_NAME = `COALESCE(${SPEAKER_FIRST_NAME}, '') || ' ' || COALESCE(${SPEAKER_LAST_NAME}, '')`;

const SORT_EXPRESSIONS: Readonly<Record<string, string>> = {
  speaker: `LOWER(${SPEAKER_FULL_NAME})`,
  proposal: "LOWER(sp.title)",
  registration: "COALESCE(r.status, '')",
};

/** One proposal-speaker row per list item; search, filters, sort and page stay in D1. */
export function buildEventProposalSpeakersPageQuery(eventId: string, query: EventSpeakersListQuery): OffsetPageQuery {
  const conditions = ["sp.event_id = ?", "sp.deleted_at IS NULL"];
  const bindings: unknown[] = [eventId];
  if (query.registration === "registered") {
    conditions.push("r.status = 'registered'");
  } else if (query.registration === "missing") {
    conditions.push("ps.status <> 'declined'", "(r.status IS NULL OR r.status <> 'registered')");
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [SPEAKER_FULL_NAME, "u.email", SPEAKER_ORGANIZATION, "sp.title"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const sortKey = query.sort.startsWith("-") ? query.sort.slice(1) : query.sort;
  const direction = query.sort.startsWith("-") ? "DESC" : "ASC";
  return {
    source: {
      selectSql: `SELECT ps.id, ps.proposal_id AS proposalId, ps.status, ps.user_id AS userId,
        ${proposalSpeakerHeadshotColumns()},
        sp.title AS proposalTitle,
        u.email AS email,
        ${SPEAKER_FIRST_NAME} AS firstName,
        ${SPEAKER_LAST_NAME} AS lastName,
        ${SPEAKER_ORGANIZATION} AS organizationName,
        r.id AS registrationId, r.status AS registrationStatus, r.attendance_type AS attendanceType,
        disclosure.review_status AS independentCapacityStatus`,
      fromSql: `FROM proposal_speakers ps
        JOIN session_proposals sp ON sp.id = ps.proposal_id
        JOIN users u ON u.id = ps.user_id
        LEFT JOIN registrations r ON r.event_id = sp.event_id AND r.user_id = ps.user_id
        LEFT JOIN proposal_speaker_independent_disclosures disclosure
          ON disclosure.proposal_speaker_id = ps.id AND disclosure.superseded_at IS NULL
        WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy: `ORDER BY ${SORT_EXPRESSIONS[sortKey]} ${direction}, sp.title ASC, ps.id ASC`,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listEventProposalSpeakers(db: DatabaseLike, eventId: string, query: EventSpeakersListQuery) {
  const { rows, total } = await queryPage<SpeakerRow>(db, buildEventProposalSpeakersPageQuery(eventId, query));
  const days = await loadRegistrationDayStates(
    db,
    rows.flatMap((row) => (row.registrationId ? [row.registrationId] : [])),
  );
  return {
    speakers: rows.map((row) => {
      const { registrationId, userId: _userId, headshot_r2_key: _key, headshot_updated_at: _updated, ...speaker } = row;
      return {
        ...speaker,
        headshotUrl: speakerHeadshotPath(row),
        days: registrationId ? (days.get(registrationId) ?? []) : [],
      };
    }),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  };
}
