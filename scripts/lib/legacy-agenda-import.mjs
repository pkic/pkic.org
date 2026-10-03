import { createHash } from "node:crypto";
import { contentAgendaSlotTiming } from "../../assets/shared/content-agenda-timing.ts";

/** Explicit canonical mappings only: names never silently create or match people. */
export function prepareLegacyAgendaImport(
  source,
  { sourcePath, roomIds = {}, speakerUserIds = {}, presentationUrls = {}, recordingUrls = {}, expectedRevision = 0 },
) {
  const unresolved = [];
  const occurrences = [];
  for (const [date, slots] of Object.entries(source.agenda ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [slotIndex, slot] of slots.entries()) {
      let timing;
      try {
        timing = contentAgendaSlotTiming(date, source.timezone, slot, slots[slotIndex + 1], source.transitionMinutes);
      } catch (error) {
        unresolved.push({ sourcePath, date, slotIndex, kind: "time", message: error.message });
        continue;
      }
      const sessions = slot.sessions?.length
        ? slot.sessions
        : [{ title: slot.title ?? "Break", locations: [], speakers: [], description: "" }];
      for (const [sessionIndex, session] of sessions.entries()) {
        const sourceKey = `legacy:${createHash("sha256")
          .update(`${sourcePath}:${date}:${session.id ?? `${slot.time}:${sessionIndex}`}`)
          .digest("hex")}`;
        const context = { sourceKey, date, time: slot.time, title: session.title ?? slot.title ?? "Session" };
        const duration = session.durationMinutes ?? timing.durationMinutes;
        const rooms = (session.locations ?? []).map((name) => roomIds[name]);
        const names = (session.speakers ?? []).map((name) => name.replace(/ \*$/u, ""));
        const speakers = names.map((name) => speakerUserIds[name]);
        for (const name of session.locations ?? [])
          if (!roomIds[name]) unresolved.push({ ...context, kind: "room", value: name });
        for (const name of names)
          if (!speakerUserIds[name]) unresolved.push({ ...context, kind: "speaker", value: name });
        if (rooms.length > 1) unresolved.push({ ...context, kind: "multiple_rooms", value: session.locations });
        if (!duration || duration <= 0)
          unresolved.push({
            ...context,
            kind: "duration",
            message: "Supply an explicit positive duration for the final slot.",
          });
        const presentationUrl = session.presentation
          ? (presentationUrls[session.presentation] ??
            (/^https?:\/\//u.test(session.presentation) ? session.presentation : null))
          : null;
        const recordingUrl = session.youtube
          ? (recordingUrls[session.youtube] ??
            (/^https?:\/\//u.test(session.youtube)
              ? session.youtube
              : /^[A-Za-z0-9_-]{11}$/u.test(session.youtube)
                ? `https://www.youtube.com/watch?v=${session.youtube}`
                : null))
          : null;
        if ((session.presentation && !presentationUrl) || (session.youtube && !recordingUrl))
          unresolved.push({
            ...context,
            kind: "media",
            presentation: session.presentation ?? null,
            recording: session.youtube ?? null,
            message: "Map authored asset references to canonical public URLs.",
          });
        if (
          rooms.some((value) => !value) ||
          speakers.some((value) => !value) ||
          rooms.length > 1 ||
          !duration ||
          duration <= 0 ||
          (session.presentation && !presentationUrl) ||
          (session.youtube && !recordingUrl)
        )
          continue;
        occurrences.push({
          sourceKey,
          title: context.title,
          description: session.description ?? "",
          presentationUrl,
          recordingUrl,
          startAt: timing.startsAt,
          endAt: new Date(Date.parse(timing.startsAt) + duration * 60000).toISOString(),
          roomId: rooms[0] ?? null,
          speakerUserIds: [...new Set(speakers)],
          admissionPolicy: "preference",
          capacity: null,
          remoteCapacity: null,
          visibility: "public",
          kind: slot.sessions?.length ? "session" : "break",
        });
      }
    }
  }
  return {
    payload: { source: "legacy", dryRun: true, expectedRevision, occurrences },
    unresolved,
    ready: unresolved.length === 0,
  };
}
