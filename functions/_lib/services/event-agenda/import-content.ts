import { agendaContentFieldsSchema } from "../../../../assets/shared/schemas/event-agenda-content";
import { agendaContentSourceSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-source-snapshot";
import type { DatabaseLike, StatementLike } from "../../types";
import { all } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { prepareCreateAgendaContent } from "./content-library";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
const comparableContent = (content: ReturnType<typeof agendaContentFieldsSchema.parse>) =>
  JSON.stringify(
    agendaContentFieldsSchema.parse({
      ...content,
      track: content.track ?? null,
      speakerUserIds: [...content.speakerUserIds].sort(),
    }),
  );
/** Source edits are review candidates. Imported text and rosters never overwrite later organizer edits. */
export async function prepareImportContentReviews(
  db: DatabaseLike,
  eventId: string,
  snapshot: AgendaSnapshot,
  candidates: Array<{
    sourceKey: string;
    title: string;
    description: string;
    kind: "session" | "break" | "plenary";
    track?: string | null;
    speakerUserIds: string[];
    speakerRoles?: unknown;
  }>,
  proposalStatuses?: Map<string, string>,
) {
  const sourceKeys = JSON.stringify([
    ...new Set([
      ...candidates.map((candidate) => candidate.sourceKey),
      ...[...(proposalStatuses?.keys() ?? [])].map((id) => `proposal:${id}`),
    ]),
  ]);
  const contents = await all<{
    id: string;
    source_key: string;
    source_snapshot_json: string | null;
    source_review_json: string | null;
  }>(
    db,
    "SELECT id,source_key,source_snapshot_json,source_review_json FROM event_agenda_contents WHERE event_id=? AND source_key IN(SELECT value FROM json_each(?))",
    [eventId, sourceKeys],
  );
  const occurrences = await all<{ id: string; source_key: string; content_id: string | null }>(
    db,
    "SELECT id,source_key,content_id FROM event_agenda_occurrences WHERE event_id=? AND source_key IN(SELECT value FROM json_each(?))",
    [eventId, sourceKeys],
  );
  const statements: StatementLike[] = [],
    contentIds = new Map<string, string>();
  let reviewRequired = 0;
  const reviewSourceKeys = new Set<string>();
  for (const candidate of candidates) {
    const content = agendaContentFieldsSchema.parse(candidate);
    const incoming = comparableContent(content);
    const existing = contents.find((row) => row.source_key === candidate.sourceKey);
    const occurrence = occurrences.find((row) => row.source_key === candidate.sourceKey);
    if (!existing) {
      const id = crypto.randomUUID();
      contentIds.set(candidate.sourceKey, id);
      const prior = occurrence ? snapshot.occurrences.find((item) => item.id === occurrence.id) : null;
      statements.push(
        prepareCreateAgendaContent(
          db,
          eventId,
          id,
          prior
            ? {
                title: prior.title,
                description: prior.description,
                kind: prior.kind,
                track: prior.track,
                speakerUserIds: prior.speakers.map((s) => s.userId),
                speakerRoles: Object.fromEntries(
                  prior.speakers.filter((s) => s.role && s.role !== "speaker").map((s) => [s.userId, s.role]),
                ),
              }
            : content,
          candidate.sourceKey,
        ),
      );
      if (occurrence)
        statements.push(
          db
            .prepare(
              "UPDATE event_agenda_occurrences SET content_id=? WHERE id=? AND event_id=? AND content_id IS NULL",
            )
            .bind(id, occurrence.id, eventId),
        );
      if (
        prior &&
        comparableContent(
          agendaContentFieldsSchema.parse({
            title: prior.title,
            description: prior.description,
            kind: prior.kind,
            track: prior.track,
            speakerUserIds: prior.speakers.map((s) => s.userId).sort(),
            speakerRoles: Object.fromEntries(
              prior.speakers.filter((s) => s.role && s.role !== "speaker").map((s) => [s.userId, s.role]),
            ),
          }),
        ) !== incoming
      ) {
        reviewRequired++;
        reviewSourceKeys.add(candidate.sourceKey);
        statements.push(
          db
            .prepare("UPDATE event_agenda_contents SET source_review_json=? WHERE id=?")
            .bind(JSON.stringify({ reason: "local_edits", incoming: content }), id),
        );
      }
      continue;
    }
    contentIds.set(candidate.sourceKey, existing.id);
    const baseline = existing.source_snapshot_json
      ? agendaContentFieldsSchema.parse(
          agendaContentSourceSnapshotSchema.parse(JSON.parse(existing.source_snapshot_json)),
        )
      : null;
    const baselineJson = baseline ? comparableContent(baseline) : null;
    if (baselineJson !== incoming) {
      reviewRequired++;
      reviewSourceKeys.add(candidate.sourceKey);
      const review = JSON.stringify({ reason: "source_changed", incoming: content });
      if (review !== existing.source_review_json)
        statements.push(
          db
            .prepare("UPDATE event_agenda_contents SET source_review_json=?,updated_at=? WHERE id=? AND event_id=?")
            .bind(review, nowIso(), existing.id, eventId),
        );
    }
  }
  if (proposalStatuses)
    for (const existing of contents) {
      if (!existing.source_key.startsWith("proposal:")) continue;
      const status = proposalStatuses.get(existing.source_key.slice(9));
      if (status && status !== "accepted") {
        reviewRequired++;
        reviewSourceKeys.add(existing.source_key);
        const review = JSON.stringify({ reason: "source_withdrawn", incoming: null });
        if (review !== existing.source_review_json)
          statements.push(
            db
              .prepare("UPDATE event_agenda_contents SET source_review_json=?,updated_at=? WHERE id=? AND event_id=?")
              .bind(review, nowIso(), existing.id, eventId),
          );
      }
    }
  return { statements, contentIds, reviewRequired, reviewSourceKeys: [...reviewSourceKeys] };
}
