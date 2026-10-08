import type { DatabaseLike } from "../../functions/_lib/types";
import { first } from "../../functions/_lib/db/queries";
import {
  sessionAppearanceSchema,
  sessionHistoryMetadataSchema,
  type SessionAppearance,
} from "../../assets/shared/schemas/event-session-history";

/** Synthetic fixtures explicitly declare individual representation and their reviewed public credit. */
export function individualAppearanceFixture(input: {
  userId: string;
  displayName: string;
  approvedAt: string;
}): SessionAppearance {
  return sessionAppearanceSchema.parse({
    ...input,
    actingIdentityId: null,
    organizationName: null,
    jobTitle: null,
    biography: "",
    photoUrl: null,
  });
}

/** Seed explicit appearance inputs only in the test that needs publication authority, retaining other source metadata. */
export async function seedApprovedSessionAppearances(
  db: DatabaseLike,
  input: { occurrenceId: string; reviewerId: string; appearances: SessionAppearance[] },
) {
  const previous = await first<{ metadata_json: string }>(
    db,
    "SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?",
    [input.occurrenceId],
  );
  const history = sessionHistoryMetadataSchema.parse({
    ...(previous ? JSON.parse(previous.metadata_json) : {}),
    appearances: input.appearances,
  });
  await db
    .prepare(
      "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(occurrence_id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
    )
    .bind(input.occurrenceId, JSON.stringify(history), input.reviewerId, input.appearances[0]?.approvedAt ?? null)
    .run();
}
