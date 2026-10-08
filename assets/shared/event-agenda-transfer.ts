import type { z } from "zod";
import { agendaTransferSchema, transferPrepareSchema, transferFindingSchema } from "./schemas/event-agenda-transfer";
import { agendaImportSchema } from "./schemas/event-agenda";
type Input = z.infer<typeof transferPrepareSchema>;
type Finding = z.infer<typeof transferFindingSchema>;
/** No name-based identity inference; source-only archival credits retain explicit unlinked attribution. */
export function normalizeAgendaTransfer(input: Input) {
  const findings: Finding[] = [];
  const add = (
    rowRef: string | null,
    field: string,
    code: Finding["code"],
    message: string,
    severity: Finding["severity"] = "blocking",
  ) => findings.push({ rowRef, field, code, message, severity });
  const unique = (values: string[], field: string) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) add(null, field, "duplicate_source", `Duplicate reference: ${value}`);
      seen.add(value);
    }
  };
  unique(
    input.document.people.map((p) => p.ref),
    "people",
  );
  unique(
    input.document.rooms.map((r) => r.ref),
    "rooms",
  );
  unique(
    input.document.occurrences.map((r) => r.ref),
    "occurrences",
  );
  unique(
    input.document.occurrences.map((r) => r.sourceKey),
    "sourceKey",
  );
  const people = new Map(input.document.people.map((p) => [p.ref, p]));
  const rooms = new Map(input.document.rooms.map((r) => [r.ref, r]));
  const occurrences: z.infer<typeof agendaImportSchema>["occurrences"] = [];
  for (const row of input.document.occurrences) {
    if (input.resolutions.rows[row.ref] === "skip" || input.resolutions.rows[row.ref] === "retain_local") continue;
    const before = findings.length;
    for (const ref of Object.keys(row.personRoles)) {
      if (!row.personRefs.includes(ref))
        add(row.ref, ref, "invalid_reference", "An occurrence credit role must reference one of its people.");
    }
    const ids = row.personRefs.map((ref) => {
      const person = people.get(ref),
        chosen = input.resolutions.people[ref]?.userId ?? person?.canonicalUserId;
      if (!person) add(row.ref, ref, "invalid_reference", "This person reference is absent from the document.");
      const credit = row.archive?.archivalCredits.find((credit) => credit.sourceRef === ref);
      if (!chosen && input.mode === "archive" && credit && person)
        add(
          row.ref,
          ref,
          "historical_credit_unlinked",
          "Preserved historical attribution; canonical speaker availability cannot be checked.",
          "information",
        );
      else if (!chosen)
        add(row.ref, ref, "person_unresolved", `Choose the canonical person for ${person?.label ?? ref}.`);
      return chosen;
    });
    const roomIds = row.roomRefs.map((ref) => {
      const room = rooms.get(ref),
        chosen = input.resolutions.rooms[ref] ?? room?.canonicalRoomId;
      if (!room) add(row.ref, ref, "invalid_reference", "This location reference is absent from the document.");
      if (!chosen) add(row.ref, ref, "room_unresolved", `Choose the event location for ${room?.label ?? ref}.`);
      return chosen;
    });
    const media = row.media.map((item) => {
      const url = input.resolutions.media[item.authoredReference] ?? item.publicUrl;
      if (!url)
        add(row.ref, item.authoredReference, "media_unresolved", "Resolve this authored asset to a stable public URL.");
      return { ...item, publicUrl: url };
    });
    const partial =
      input.mode === "archive" &&
      row.archive?.archivalTiming !== null &&
      Boolean(row.archive?.archivalTiming) &&
      row.timing.endAt === null &&
      row.timing.endSource === "unresolved";
    if (
      input.mode === "archive" &&
      !partial &&
      (!row.timing.startAt || !row.timing.endAt || row.timing.startAt >= row.timing.endAt)
    )
      add(row.ref, "timing", "timing_unresolved", "Supply an explicit valid UTC session interval.");
    if (row.timing.endSource !== "explicit")
      add(
        row.ref,
        "timing",
        "timing_inferred",
        input.mode === "copy_as_new"
          ? "The source end time was inferred or missing. Choose and confirm new times when scheduling this copied session."
          : row.timing.endSource === "unresolved"
            ? "The source does not establish an end time. Review the preserved historical start; no scheduled interval is asserted."
            : "The end time was inferred from the program. Confirm it against the historical source before importing.",
        "review",
      );
    if (findings.slice(before).some((f) => f.severity === "blocking")) continue;
    const copy = input.mode === "copy_as_new";
    occurrences.push({
      ...row.fields,
      sourceKey: copy ? `copy:${input.document.source.sourceDigest}:${row.ref}` : row.sourceKey,
      startAt: copy || partial ? null : row.timing.startAt,
      endAt: copy || partial ? null : row.timing.endAt,
      roomId: copy ? null : (roomIds[0] ?? null),
      additionalRoomIds: copy ? [] : (roomIds.slice(1) as string[]),
      visibility: copy ? "private" : row.fields.visibility,
      admissionPolicy: copy ? "preference" : row.fields.admissionPolicy,
      accessPolicy: copy ? "open" : row.fields.accessPolicy,
      capacity: copy ? null : row.fields.capacity,
      remoteCapacity: copy ? null : row.fields.remoteCapacity,
      bookingOpensAt: copy ? null : row.fields.bookingOpensAt,
      bookingClosesAt: copy ? null : row.fields.bookingClosesAt,
      presentationUrl: media.find((m) => m.kind === "presentation")?.publicUrl ?? null,
      recordingUrl: media.find((m) => m.kind === "recording")?.publicUrl ?? null,
      speakerUserIds: [...new Set(ids.filter((id): id is string => Boolean(id)))],
      speakerRoles: Object.fromEntries(
        row.personRefs.flatMap((ref, i) => (ids[i] ? [[ids[i], row.personRoles[ref] ?? people.get(ref)!.role]] : [])),
      ),
    });
  }
  return { occurrences: agendaImportSchema.shape.occurrences.parse(occurrences), findings };
}
export async function agendaTransferDigest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function parseAgendaTransfer(value: unknown) {
  return agendaTransferSchema.parse(value);
}
