import { z } from "zod";
import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { listAgendaOccurrences, getAgenda } from "./read";
import { agendaTransferDigest } from "../../../../assets/shared/event-agenda-transfer";
import { agendaOccurrenceQuerySchema } from "../../../../assets/shared/schemas/event-agenda";
import { agendaTransferSchema } from "../../../../assets/shared/schemas/event-agenda-transfer";
import { agendaContentSourceSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-source-snapshot";
import { historicalReviewPersonSchema } from "../../../../assets/shared/schemas/event-agenda-historical-review";
import { AppError } from "../../errors";

// Early imports lack source refs; they never grant permission to infer a canonical mapping from a name.
const importedPeopleSchema = z.array(historicalReviewPersonSchema.partial({ sourceRef: true })).max(30);

export async function exportAgendaTransfer(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  query: z.infer<typeof agendaOccurrenceQuerySchema>,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug),
    collection = await listAgendaOccurrences(db, eventId, query),
    rows = collection.occurrences,
    digest = await agendaTransferDigest({ eventId, revision: snapshot.revision });
  const provenance = await all<{
    occurrence_id: string;
    source_key: string | null;
    source_path: string | null;
    source_ref: string | null;
    source_anchor: string | null;
    source_digest: string | null;
    timing_json: string | null;
    media_json: string | null;
    people_json: string | null;
    source_snapshot_json: string | null;
  }>(
    db,
    "SELECT occurrence.id AS occurrence_id,occurrence.source_key,provenance.source_path,provenance.source_ref,provenance.source_anchor,provenance.source_digest,provenance.timing_json,provenance.media_json,provenance.people_json,content.source_snapshot_json FROM event_agenda_occurrences occurrence LEFT JOIN event_agenda_import_provenance provenance ON provenance.occurrence_id=occurrence.id LEFT JOIN event_agenda_contents content ON content.id=occurrence.content_id AND content.event_id=occurrence.event_id WHERE occurrence.event_id=? AND occurrence.id IN(SELECT value FROM json_each(?))",
    [eventId, JSON.stringify(rows.map((r) => r.id))],
  );
  const records = new Map(provenance.map((record) => [record.occurrence_id, record]));
  const sourceSnapshots = new Map(
    rows.map((row) => {
      const record = records.get(row.id);
      return [
        row.id,
        record?.source_snapshot_json
          ? agendaContentSourceSnapshotSchema.parse(JSON.parse(record.source_snapshot_json))
          : null,
      ];
    }),
  );
  const acceptedSources = new Map(
    rows.map((row) => {
      const record = records.get(row.id);
      return [
        row.id,
        sourceSnapshots
          .get(row.id)
          ?.historicalMetadataEvidence?.find(
            (entry) => entry.occurrenceId === row.id && entry.sourceKey === record?.source_key,
          ),
      ];
    }),
  );
  const representedPeople = new Map(
    rows.map((row) => {
      const record = records.get(row.id),
        accepted = acceptedSources.get(row.id);
      const bindings =
        accepted?.people ?? (record?.people_json ? importedPeopleSchema.parse(JSON.parse(record.people_json)) : []);
      return [
        row.id,
        row.speakers.flatMap((speaker) => {
          const actingIdentityId =
            row.history?.appearances.find((appearance) => appearance.userId === speaker.userId)?.actingIdentityId ??
            null;
          const boundRefs = bindings
            .filter(
              (person) =>
                person.userId === speaker.userId && person.actingIdentityId === actingIdentityId && person.sourceRef,
            )
            .map((person) => person.sourceRef!);
          return [...new Set(boundRefs.length ? boundRefs : [`${row.id}:${speaker.userId}`])].map((ref) => ({
            ref,
            label: speaker.displayName,
            canonicalUserId: speaker.userId,
            actingIdentityId,
            role: speaker.role ?? "speaker",
          }));
        }),
      ];
    }),
  );
  for (const row of rows)
    if (
      row.history?.sourceDecisions.some(
        (decision) =>
          decision.decision === "reviewed_credit" &&
          !representedPeople.get(row.id)?.some((person) => person.ref === decision.resolvedValue),
      )
    )
      throw new AppError(
        409,
        "AGENDA_EXPORT_SOURCE_MAPPING_REQUIRED",
        "A reviewed credit lacks its exact stored canonical source mapping. Review its mapping before exporting.",
      );
  const people = new Map<string, z.infer<typeof agendaTransferSchema>["people"][number]>();
  const rooms = new Map<string, z.infer<typeof agendaTransferSchema>["rooms"][number]>(
    snapshot.rooms.map((room) => [room.id, { ref: room.id, label: room.name, canonicalRoomId: room.id }]),
  );
  // A removed location remains a declared historical binding, requiring explicit mapping in a fresh event.
  for (const row of rows)
    for (const fragment of row.history?.legacyFragments ?? [])
      if (fragment.roomId && !rooms.has(fragment.roomId))
        rooms.set(fragment.roomId, {
          ref: fragment.roomId,
          label: fragment.roomRef.slice(0, 160),
          canonicalRoomId: fragment.roomId,
        });
  for (const row of rows) {
    const candidates = [
      ...(representedPeople.get(row.id) ?? []),
      ...(row.history?.archivalCredits ?? []).map((credit) => ({
        ref: credit.sourceRef,
        label: credit.displayName,
        canonicalUserId: null,
        actingIdentityId: null,
        role: credit.role,
      })),
    ];
    for (const person of candidates) {
      const previous = people.get(person.ref);
      if (
        previous &&
        (previous.canonicalUserId !== person.canonicalUserId || previous.actingIdentityId !== person.actingIdentityId)
      )
        throw new AppError(
          409,
          "AGENDA_EXPORT_REFERENCE_CONFLICT",
          "A source reference has conflicting canonical representations. Review its mapping before exporting.",
        );
      people.set(person.ref, person);
    }
  }
  return agendaTransferSchema.parse({
    page: collection.page,
    format: "pkic-agenda",
    version: 1,
    source: { kind: "portable", eventRef: eventSlug, exportedAt: nowIso(), sourceDigest: digest },
    people: [...people.values()],
    rooms: [...rooms.values()],
    occurrences: rows.map((r) => ({
      ref: r.id,
      // Archive reimports reconcile with their original source; copy-as-new derives a fresh key during normalization.
      sourceKey: provenance.find((p) => p.occurrence_id === r.id)?.source_key ?? `portable:${eventId}:${r.id}`,
      sourceAnchor: r.publicAnchor ?? `session-${r.id}`,
      sourcePath:
        acceptedSources.get(r.id)?.sourcePath ??
        records.get(r.id)?.source_path ??
        snapshot.publicAgendaPath ??
        eventSlug,
      sourceDigest: acceptedSources.get(r.id)?.sourceDigest ?? records.get(r.id)?.source_digest ?? undefined,
      retainedSourceEvidence: [
        ...new Map(
          [
            ...(sourceSnapshots.get(r.id)?.retainedSourceEvidence ?? []),
            ...((r.history?.legacyFragments.length || r.history?.legacyDownloads.length) &&
            records.get(r.id)?.source_path &&
            records.get(r.id)?.source_digest &&
            records.get(r.id)?.source_ref
              ? [
                  {
                    sourcePath: records.get(r.id)!.source_path!,
                    sourceDigest: records.get(r.id)!.source_digest!,
                    sourceRef: records.get(r.id)!.source_ref!,
                  },
                ]
              : []),
            ...(acceptedSources.get(r.id)?.retainedSourceEvidence ?? []),
            ...(acceptedSources.get(r.id)
              ? [
                  acceptedSources.get(r.id)!.originalSource,
                  {
                    sourcePath: acceptedSources.get(r.id)!.sourcePath,
                    sourceDigest: acceptedSources.get(r.id)!.sourceDigest,
                    sourceRef: acceptedSources.get(r.id)!.sourceRef,
                  },
                ]
              : []),
          ].map((source) => [JSON.stringify(source), source]),
        ).values(),
      ],
      fields: r,
      timing: provenance.find((p) => p.occurrence_id === r.id)?.timing_json
        ? {
            ...JSON.parse(provenance.find((p) => p.occurrence_id === r.id)!.timing_json!),
            startAt: r.history?.archivalTiming?.startAt ?? r.startAt,
            endAt: r.endAt,
          }
        : {
            timeZone: snapshot.timeZone,
            authoredDate: null,
            authoredStart: null,
            startAt: r.history?.archivalTiming?.startAt ?? r.startAt,
            endAt: r.endAt,
            endSource: r.endAt ? "explicit" : "unresolved",
            transitionMinutes: 0,
            transitionSource: "none",
          },
      roomRefs: [r.roomId, ...(r.additionalRoomIds ?? [])].filter(Boolean),
      personRefs: [
        ...(representedPeople.get(r.id) ?? []).map((person) => person.ref),
        ...(r.history?.archivalCredits ?? []).map((credit) => credit.sourceRef),
      ],
      personRoles: Object.fromEntries([
        ...(representedPeople.get(r.id) ?? []).map((person) => [person.ref, person.role]),
        ...(r.history?.archivalCredits ?? []).map((credit) => [credit.sourceRef, credit.role]),
      ]),
      media: (["presentation", "recording"] as const).flatMap((kind) => {
        const candidate = [...(r.history?.materials ?? [])]
          .filter((material) => material.kind === kind && material.status !== "withdrawn")
          .sort((a, b) => b.version - a.version)[0];
        const url = (kind === "presentation" ? r.presentationUrl : r.recordingUrl) ?? candidate?.url;
        if (!url) return [];
        const record = provenance.find((p) => p.occurrence_id === r.id);
        const authored = record?.media_json
          ? (
              JSON.parse(record.media_json) as z.infer<typeof agendaTransferSchema>["occurrences"][number]["media"]
            ).find((item) => item.kind === kind)
          : undefined;
        const receipt = r.history?.legacyDownloads.find(
          (download) => download.targetUrl === url && download.pdfDigest !== null,
        );
        return [
          {
            kind,
            authoredReference: authored?.authoredReference ?? url,
            publicUrl: url,
            sourceDigest: receipt?.pdfDigest ?? (authored?.publicUrl === url ? authored.sourceDigest : null),
            bytes: receipt?.pdfBytes ?? (authored?.publicUrl === url ? (authored.bytes ?? null) : null),
          },
        ];
      }),
      archive: r.history ?? null,
    })),
  });
}
