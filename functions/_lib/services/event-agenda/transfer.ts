import {
  historicalMappingCandidates,
  transferredSessionHistory,
  transferredLegacyFragmentRoomId,
  legacyFragmentTransferRoomRef,
} from "./transfer-history";
import type { z } from "zod";
import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { getAgenda } from "./read";
import { importAgenda } from "./import";
import { readAgendaSessionFormatLabels } from "./occurrence-formats";
import { configuredAgendaSessionFormat } from "../../../../assets/shared/event-agenda-format";
import {
  normalizeAgendaTransfer,
  agendaTransferDigest,
  agendaTransferModePolicy,
} from "../../../../assets/shared/event-agenda-transfer";
import { transferPrepareSchema, transferApplySchema } from "../../../../assets/shared/schemas/event-agenda-transfer";
type Input = z.infer<typeof transferPrepareSchema>;
export async function reviewAgendaTransfer(db: DatabaseLike, eventId: string, eventSlug: string, input: Input) {
  // Review and apply hash the same canonical contract, including defaults and field order.
  input = transferPrepareSchema.parse(input);
  const snapshot = await getAgenda(db, eventId, eventSlug);
  if (snapshot.revision !== input.expectedRevision)
    throw new AppError(409, "AGENDA_REVISION_CONFLICT", "The agenda changed. Prepare a new review.");
  const normalized = normalizeAgendaTransfer(input),
    findings = normalized.findings;
  const existingSources = await all<{ id: string; source_key: string; public_anchor: string | null }>(
    db,
    "SELECT id,source_key,public_anchor FROM event_agenda_occurrences WHERE event_id=? AND source_key IN(SELECT value FROM json_each(?))",
    [eventId, JSON.stringify(normalized.occurrences.map((r) => r.sourceKey))],
  );
  const users = await all<{ id: string }>(db, "SELECT id FROM users WHERE id IN(SELECT value FROM json_each(?))", [
    JSON.stringify(normalized.occurrences.flatMap((r) => r.speakerUserIds)),
  ]);
  const identityRefs = input.document.people.flatMap((p) => {
    const chosen = input.resolutions.people[p.ref];
    return (chosen ? chosen.actingIdentityId : p.actingIdentityId)
      ? [
          {
            id: chosen ? chosen.actingIdentityId : p.actingIdentityId,
            userId: chosen?.userId ?? p.canonicalUserId,
            ref: p.ref,
          },
        ]
      : [];
  });
  const identities = await all<{
    id: string;
    user_id: string;
    started_at: string | null;
    ended_at: string | null;
    blocked_at: string | null;
  }>(
    db,
    "SELECT id,user_id,started_at,ended_at,blocked_at FROM identities WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?))",
    [JSON.stringify(identityRefs)],
  );
  const archiveClock = nowIso(),
    policy = agendaTransferModePolicy[input.mode];
  for (const row of input.document.occurrences) {
    const sourceDigest = row.sourceDigest ?? input.document.source.sourceDigest;
    const provenanceMatches = (metadata: { sourcePath: string; sourceDigest: string }) =>
      (metadata.sourcePath === row.sourcePath && metadata.sourceDigest === sourceDigest) ||
      (input.document.source.kind === "portable" &&
        row.retainedSourceEvidence.some(
          (source) => source.sourcePath === metadata.sourcePath && source.sourceDigest === metadata.sourceDigest,
        ));
    if (input.document.source.kind !== "portable" && row.retainedSourceEvidence.length)
      findings.push({
        rowRef: row.ref,
        field: "retainedSourceEvidence",
        code: "invalid_reference",
        severity: "blocking",
        message:
          "Authored Hugo rows must use their exact source document provenance; retained receipts are portable transfer evidence only.",
      });

    if (input.document.source.kind === "hugo" && sourceDigest !== input.document.source.sourceDigest)
      findings.push({
        rowRef: row.ref,
        field: "sourceDigest",
        code: "invalid_reference",
        severity: "blocking",
        message: "Authored source rows must retain their source document digest.",
      });
    const sourceDecisions = row.archive?.sourceDecisions ?? [];
    const legacyFragments = row.archive?.legacyFragments ?? [];
    const legacyDownloads = row.archive?.legacyDownloads ?? [];
    const sourceLocatorMatches = (metadata: { sourcePath: string; sourceDigest: string; sourceLocator: string }) =>
      (metadata.sourcePath === row.sourcePath &&
        metadata.sourceDigest === sourceDigest &&
        metadata.sourceLocator === row.ref) ||
      (input.document.source.kind === "portable" &&
        row.retainedSourceEvidence.some(
          (receipt) =>
            receipt.sourcePath === metadata.sourcePath &&
            receipt.sourceDigest === metadata.sourceDigest &&
            receipt.sourceRef === metadata.sourceLocator,
        ));
    const ownedOccurrence = snapshot.occurrences.find((occurrence) =>
      existingSources.some((source) => source.source_key === row.sourceKey && source.id === occurrence.id),
    );
    if (
      policy.retainsSource &&
      (legacyFragments.some((fragment) => {
        const roomId = transferredLegacyFragmentRoomId(input, fragment);
        const rowRoomIds = row.roomRefs.map(
          (ref) =>
            input.resolutions.rooms[ref] ?? input.document.rooms.find((room) => room.ref === ref)?.canonicalRoomId,
        );
        const roomRef = legacyFragmentTransferRoomRef(input, fragment);
        const unchangedOwnedFragment =
          input.document.source.kind === "portable" &&
          roomId === fragment.roomId &&
          ownedOccurrence?.history?.legacyFragments.some((owned) => JSON.stringify(owned) === JSON.stringify(fragment));
        const explicitlyMappedRoom = roomRef && input.resolutions.rooms[roomRef] === roomId;
        const explicitlyMappedUnassignedHistory =
          input.document.source.kind === "portable" &&
          row.roomRefs.length === 0 &&
          explicitlyMappedRoom &&
          snapshot.rooms.some((room) => room.id === roomId);
        return (
          !sourceLocatorMatches(fragment) ||
          !roomId ||
          (!rowRoomIds.includes(roomId) && !unchangedOwnedFragment && !explicitlyMappedUnassignedHistory) ||
          (input.document.source.kind === "portable" &&
            !row.roomRefs.includes(roomRef ?? "") &&
            !unchangedOwnedFragment &&
            !explicitlyMappedRoom) ||
          (input.document.source.kind === "hugo" &&
            (!row.roomRefs.includes(fragment.roomRef) ||
              fragment.authoredDate !== row.timing.authoredDate ||
              fragment.authoredStart !== row.timing.authoredStart))
        );
      }) ||
        legacyDownloads.some((download) => {
          const matchingPdf = row.media.some(
            (media) =>
              media.kind === "presentation" &&
              media.publicUrl === download.targetUrl &&
              (download.pdfDigest === null ||
                (media.sourceDigest === download.pdfDigest && media.bytes === download.pdfBytes)),
          );
          const original = ownedOccurrence?.history?.legacyDownloads.find((item) => item.url === download.url);
          const enrichesPdf = original?.pdfDigest === null && download.pdfDigest !== null;
          const declaresCurrentPdf =
            download.pdfDigest !== null &&
            row.media.some((media) => media.kind === "presentation" && media.publicUrl === download.targetUrl);
          return (
            !sourceLocatorMatches(download) ||
            (enrichesPdf && !matchingPdf) ||
            (declaresCurrentPdf && !matchingPdf) ||
            (input.document.source.kind === "portable"
              ? !row.retainedSourceEvidence.some(
                  (receipt) =>
                    receipt.sourcePath === download.sourcePath &&
                    receipt.sourceDigest === download.sourceDigest &&
                    receipt.sourceRef === download.sourceLocator,
                )
              : !matchingPdf)
          );
        }))
    )
      findings.push({
        rowRef: row.ref,
        field: "archive",
        code: "invalid_reference",
        severity: "blocking",
        message:
          "Historical links require exact authored source evidence and an owned or explicitly mapped location; authored downloads must match their source media target.",
      });
    if (
      sourceDecisions.some(
        (decision) =>
          !sourceLocatorMatches(decision) ||
          decision.reviewedAt > archiveClock ||
          (decision.kind === "title" && decision.resolvedValue !== row.fields.title) ||
          (decision.decision === "credit_not_recorded" &&
            row.personRefs.some((ref) =>
              input.document.people.some((person) => person.ref === ref && person.label === decision.authoredValue),
            )) ||
          (decision.decision === "reviewed_credit" &&
            !row.personRefs.some((ref) => {
              if (ref !== decision.resolvedValue) return false;
              const person = input.document.people.find((item) => item.ref === ref),
                resolved = input.resolutions.people[ref];
              const userId = resolved?.userId ?? person?.canonicalUserId;
              const identityId = resolved ? resolved.actingIdentityId : (person?.actingIdentityId ?? null);
              return (
                userId &&
                row.archive?.appearances.some(
                  (appearance) =>
                    appearance.userId === userId &&
                    appearance.actingIdentityId === identityId &&
                    appearance.approvedAt <= archiveClock,
                )
              );
            })) ||
          (decision.decision === "retain_source_credit" &&
            !row.archive?.archivalCredits.some((credit) => credit.displayName === decision.resolvedValue)),
      ) ||
      new Set(
        sourceDecisions.map((decision) =>
          JSON.stringify([
            decision.kind,
            decision.sourceLocator,
            ...(decision.kind === "credit" ? [decision.authoredValue] : []),
          ]),
        ),
      ).size !== sourceDecisions.length
    )
      findings.push({
        rowRef: row.ref,
        field: "archive",
        code: "invalid_reference",
        severity: "blocking",
        message:
          "Historical review decisions must retain exact row source provenance and match the resolved representation.",
      });
    const partial = row.archive?.archivalTiming;
    if (
      partial &&
      policy.attribution === "archival" &&
      (!row.timing.startAt ||
        row.timing.startAt >= archiveClock ||
        row.timing.endAt !== null ||
        row.timing.endSource !== "unresolved" ||
        partial.startAt !== row.timing.startAt ||
        partial.timeZone !== row.timing.timeZone ||
        partial.authoredDate !== row.timing.authoredDate ||
        partial.authoredStart !== row.timing.authoredStart ||
        !provenanceMatches(partial))
    )
      findings.push({
        rowRef: row.ref,
        field: "timing",
        code: "timing_unresolved",
        severity: "blocking",
        message:
          "Partial historical timing requires an exact past authored start and source provenance, with no asserted end.",
      });
    const credits = row.archive?.archivalCredits ?? [];
    if (credits.length && policy.attribution === "archival") {
      const invalid =
        (!row.timing.endAt && !partial) ||
        (row.timing.endAt !== null && row.timing.endAt >= archiveClock) ||
        new Set(credits.map((credit) => credit.sourceRef)).size !== credits.length ||
        credits.some((credit) => {
          const person = input.document.people.find((person) => person.ref === credit.sourceRef);
          return (
            !row.personRefs.includes(credit.sourceRef) ||
            !person ||
            Boolean(input.resolutions.people[credit.sourceRef]?.userId ?? person.canonicalUserId) ||
            (input.document.source.kind === "hugo" &&
              credit.role !== (row.personRoles[credit.sourceRef] ?? person.role)) ||
            !provenanceMatches(credit)
          );
        });
      if (invalid)
        findings.push({
          rowRef: row.ref,
          field: "archive",
          code: "identity_invalid",
          severity: "blocking",
          message:
            "Source-only credits require a past historical interval, exact source provenance and an unlinked person reference.",
        });
    }
    if (
      row.archive &&
      (new Set(row.archive.appearances.map((appearance) => appearance.userId)).size !==
        row.archive.appearances.length ||
        row.archive.appearances.some(
          (a) =>
            a.approvedAt > archiveClock ||
            !row.personRefs.some((ref) => {
              const p = input.document.people.find((p) => p.ref === ref),
                resolved = input.resolutions.people[ref];
              return (
                a.userId === (resolved?.userId ?? p?.canonicalUserId) &&
                a.actingIdentityId === (resolved ? resolved.actingIdentityId : (p?.actingIdentityId ?? null))
              );
            }),
        ))
    )
      findings.push({
        rowRef: row.ref,
        field: "archive",
        code: "identity_invalid",
        severity: "blocking",
        message: "Historical appearances must match the explicitly resolved canonical people and identities.",
      });
    if (["skip", "retain_local"].includes(input.resolutions.rows[row.ref] ?? "")) continue;
    for (const ref of row.personRefs) {
      const person = input.document.people.find((p) => p.ref === ref),
        chosen = input.resolutions.people[ref],
        userId = chosen?.userId ?? person?.canonicalUserId;
      if (userId && !users.some((u) => u.id === userId))
        findings.push({
          rowRef: row.ref,
          field: ref,
          code: "person_unresolved",
          severity: "blocking",
          message: "The canonical person is unavailable. Choose an existing person.",
        });
      const identityId = chosen ? chosen.actingIdentityId : person?.actingIdentityId;
      if (identityId) {
        const identity = identities.find((i) => i.id === identityId),
          date = row.timing.startAt;
        if (
          !identity ||
          identity.user_id !== userId ||
          !date ||
          !identity.started_at ||
          identity.started_at > date ||
          (identity.ended_at && identity.ended_at <= date) ||
          (identity.blocked_at && identity.blocked_at <= date)
        )
          findings.push({
            rowRef: row.ref,
            field: ref,
            code: "identity_invalid",
            severity: "blocking",
            message: "Choose an identity owned by this person and active at the session date.",
          });
      }
    }
    if (
      policy.retainsSource &&
      row.sourceAnchor &&
      snapshot.occurrences.some(
        (o) =>
          o.publicAnchor === row.sourceAnchor &&
          !existingSources.some(
            (existing) => existing.source_key === row.sourceKey && existing.public_anchor === row.sourceAnchor,
          ),
      )
    )
      findings.push({
        rowRef: row.ref,
        field: "sourceAnchor",
        code: "anchor_collision",
        severity: "blocking",
        message: "This public anchor is already used. Retain the existing row or supply a distinct source anchor.",
      });
  }
  const anchors = input.document.occurrences
    .filter((r) => input.resolutions.rows[r.ref] !== "skip" && input.resolutions.rows[r.ref] !== "retain_local")
    .map((r) => r.sourceAnchor)
    .filter(Boolean);
  if (new Set(anchors).size !== anchors.length)
    findings.push({
      rowRef: null,
      field: "sourceAnchor",
      code: "anchor_collision",
      severity: "blocking",
      message: "Choose a unique public anchor for each imported occurrence.",
    });
  if (policy.retainsSource) {
    const importedKeys = new Set(
      input.document.occurrences
        .filter((row) => !["skip", "retain_local"].includes(input.resolutions.rows[row.ref] ?? ""))
        .map((row) => row.sourceKey),
    );
    const owners = new Map<string, string>();
    for (const occurrence of snapshot.occurrences.filter(
      (item) => !existingSources.some((source) => source.id === item.id && importedKeys.has(source.source_key)),
    ))
      for (const anchor of [
        occurrence.publicAnchor,
        ...(occurrence.history?.legacyFragments.map((fragment) => fragment.anchor) ?? []),
      ].filter((anchor): anchor is string => Boolean(anchor)))
        owners.set(anchor, occurrence.id);
    for (const row of input.document.occurrences.filter((item) => importedKeys.has(item.sourceKey)))
      for (const anchor of [
        row.sourceAnchor,
        ...(row.archive?.legacyFragments.map((fragment) => fragment.anchor) ?? []),
      ].filter((anchor): anchor is string => Boolean(anchor))) {
        if (owners.has(anchor))
          findings.push({
            rowRef: row.ref,
            field: "archive",
            code: "anchor_collision",
            severity: "blocking",
            message: "This historical fragment is already owned by another occurrence.",
          });
        owners.set(anchor, row.ref);
      }
  }
  for (const occurrence of normalized.occurrences)
    for (const roomId of [occurrence.roomId, ...(occurrence.additionalRoomIds ?? [])].filter(Boolean))
      if (!snapshot.rooms.some((r) => r.id === roomId))
        findings.push({
          rowRef: occurrence.sourceKey,
          field: "room",
          code: "room_unresolved",
          severity: "blocking",
          message: "Choose a location belonging to this event.",
        });
  const formatLabels = await readAgendaSessionFormatLabels(db, eventId);
  for (const row of input.document.occurrences)
    if (row.fields.format && !configuredAgendaSessionFormat(formatLabels, row.fields.format))
      findings.push({
        rowRef: row.ref,
        field: "format",
        code: "format_unresolved",
        severity: "blocking",
        message: `Configure the session format "${row.fields.format}" for this event or map it to a configured session type.`,
      });
  let imported = 0,
    skipped = 0;
  if (!findings.some((f) => f.severity === "blocking"))
    try {
      const preview = await importAgenda(
        db,
        eventId,
        eventSlug,
        {
          source: "legacy",
          dryRun: true,
          expectedRevision: input.expectedRevision,
          occurrences: normalized.occurrences,
        },
        null,
        undefined,
        historicalMappingCandidates(input),
      );
      imported = preview.imported;
      skipped = preview.skipped;
      for (const sourceKey of preview.reviewSourceKeys) {
        const row = input.document.occurrences.find((item) => item.sourceKey === sourceKey);
        if (row)
          findings.push({
            rowRef: row.ref,
            field: "content",
            code: "local_edits",
            severity: "review",
            message:
              "This source change will be recorded for review; local content and historical approvals remain unchanged.",
          });
      }
    } catch (error) {
      findings.push({
        rowRef: null,
        field: "schedule",
        code: "schedule_collision",
        severity: "blocking",
        message: error instanceof Error ? error.message : "The schedule cannot be imported.",
      });
    }
  return {
    digest: await agendaTransferDigest(input),
    expectedRevision: input.expectedRevision,
    findings,
    ready: !findings.some((f) => f.severity === "blocking"),
    imported,
    skipped,
  };
}
export async function applyAgendaTransfer(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof transferApplySchema>,
  actorId: string,
) {
  const prepared = transferPrepareSchema.parse(input),
    review = await reviewAgendaTransfer(db, eventId, eventSlug, prepared);
  if (review.digest !== input.reviewDigest || !review.ready)
    throw new AppError(
      409,
      "AGENDA_TRANSFER_REVIEW_REQUIRED",
      "Resolve the findings and prepare a fresh review before applying.",
    );
  if (review.findings.some((f) => f.code === "timing_inferred") && !input.acknowledgeInferredTiming)
    throw new AppError(400, "AGENDA_TRANSFER_TIMING_REVIEW_REQUIRED", "Confirm the inferred timing before applying.");
  const policy = agendaTransferModePolicy[input.mode];
  if (
    policy.retainsSource &&
    input.document.occurrences.some((r) => r.archive) &&
    !input.acknowledgeArchiveRepresentation
  )
    throw new AppError(
      400,
      "AGENDA_TRANSFER_ARCHIVE_REVIEW_REQUIRED",
      "Confirm the historical representation before applying.",
    );
  const normalized = normalizeAgendaTransfer(prepared),
    clock = nowIso();
  return importAgenda(
    db,
    eventId,
    eventSlug,
    { source: "legacy", dryRun: false, expectedRevision: input.expectedRevision, occurrences: normalized.occurrences },
    actorId,
    (item) => {
      const row = input.document.occurrences.find((r) =>
        policy.retainsSource
          ? r.sourceKey === item.sourceKey
          : `copy:${input.document.source.sourceDigest}:${r.ref}` === item.sourceKey,
      )!;
      const statements = [
        db
          .prepare(
            "INSERT INTO event_agenda_import_provenance(occurrence_id,import_mode,source_format,source_version,source_path,source_ref,source_anchor,source_digest,timing_json,media_json,people_json,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            item.id,
            input.mode,
            input.document.source.kind,
            input.document.version,
            row.sourcePath,
            row.ref,
            row.sourceAnchor,
            row.sourceDigest ?? input.document.source.sourceDigest,
            JSON.stringify(row.timing),
            JSON.stringify(
              row.media.map((media) => {
                const publicUrl = input.resolutions.media[media.authoredReference] ?? media.publicUrl;
                return {
                  ...media,
                  publicUrl,
                  sourceDigest: publicUrl === media.publicUrl ? media.sourceDigest : null,
                  bytes: publicUrl === media.publicUrl ? media.bytes : null,
                };
              }),
            ),
            JSON.stringify(
              !policy.retainsSource
                ? []
                : row.personRefs.map((ref) => {
                    const person = input.document.people.find((p) => p.ref === ref)!,
                      resolved = input.resolutions.people[ref];
                    return {
                      sourceRef: ref,
                      userId: resolved?.userId ?? person.canonicalUserId,
                      actingIdentityId: resolved ? resolved.actingIdentityId : person.actingIdentityId,
                    };
                  }),
            ),
            actorId,
            clock,
          ),
      ];
      if (policy.retainsSource && row.retainedSourceEvidence.length)
        statements.push(
          db
            .prepare(
              "UPDATE event_agenda_contents SET source_snapshot_json=json_set(source_snapshot_json,'$.retainedSourceEvidence',json(?)) WHERE event_id=? AND id=(SELECT content_id FROM event_agenda_occurrences WHERE id=? AND event_id=?)",
            )
            .bind(JSON.stringify(row.retainedSourceEvidence), eventId, item.id, eventId),
        );
      if (policy.retainsSource && row.sourceAnchor)
        statements.push(
          db.prepare("UPDATE event_agenda_occurrences SET public_anchor=? WHERE id=?").bind(row.sourceAnchor, item.id),
        );
      const history = transferredSessionHistory(prepared, row);
      // Reusable materials remain draft candidates and cannot become primary public links by publication alone.
      if (history)
        statements.push(
          db
            .prepare(
              "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
            )
            .bind(item.id, JSON.stringify(history), actorId, clock),
        );
      if (history?.materials.length)
        statements.push(
          db
            .prepare("UPDATE event_agenda_occurrences SET presentation_url=NULL,recording_url=NULL WHERE id=?")
            .bind(item.id),
        );
      return statements;
    },
    historicalMappingCandidates(prepared),
  );
}
export { exportAgendaTransfer } from "./transfer-export";
