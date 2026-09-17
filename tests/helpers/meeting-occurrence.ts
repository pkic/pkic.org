import {
  createSeriesOccurrence,
  getSeriesOccurrence,
  updateSeriesOccurrence,
} from "../../functions/_lib/services/event-series";

/** Configure the automatically generated occurrence instead of creating a duplicate fixture. */
export async function configureMeetingOccurrence(...args: Parameters<typeof createSeriesOccurrence>) {
  const [db, actor, groupId, seriesId, input, secret] = args;
  const existing = await db
    .prepare(
      "SELECT id FROM event_occurrences WHERE series_id = ? AND strftime('%Y-%m-%dT%H:%M:%SZ', starts_at) = strftime('%Y-%m-%dT%H:%M:%SZ', ?) LIMIT 1",
    )
    .bind(seriesId, input.startsAt)
    .first<{ id: string }>();
  if (!existing) return createSeriesOccurrence(...args);
  const { occurrence } = await getSeriesOccurrence(db, groupId, seriesId, existing.id);
  return updateSeriesOccurrence(
    db,
    actor,
    groupId,
    seriesId,
    existing.id,
    {
      ...input,
      startsAt: occurrence.startsAt,
      endsAt: new Date(Math.floor(Date.parse(input.endsAt) / 1000) * 1000).toISOString(),
      expectedUpdatedAt: occurrence.updatedAt,
    },
    secret,
  );
}
