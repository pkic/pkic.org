import { legacyAgendaDownloads } from "./legacy-agenda-downloads.mjs";
import { legacyAgendaFragments } from "./legacy-agenda-fragments.mjs";
import { resolveLegacyAgendaRow } from "./legacy-agenda-decisions.mjs";
import { resolveLegacyAgendaFormat } from "./legacy-agenda-format.mjs";
import { legacyAgendaPeople } from "./legacy-agenda-history.mjs";
import { validateLegacyAgendaDocument, legacyAgendaSourcePath } from "./legacy-agenda-preparation.mjs";
import { createHash } from "node:crypto";
import { contentAgendaSlotTiming } from "../../assets/shared/content-agenda-timing.ts";

/** Explicit canonical mappings only: names never silently create or match people. */
export function prepareLegacyAgendaImport(source, mappings) {
  const {
    roomIds = {},
    speakerUserIds = {},
    presentationUrls = {},
    recordingUrls = {},
    mediaDigests = {},
    expectedRevision = 0,
  } = mappings;
  const sourceDigest = createHash("sha256").update(JSON.stringify(source)).digest("hex");
  const sourcePath = mappings.repositoryRoot
    ? legacyAgendaSourcePath(mappings.sourcePath, mappings.repositoryRoot)
    : mappings.sourcePath;
  const unresolved = [];
  const historicalCandidates = [];
  const sourceDecisions = [];
  const sourceRows = [];
  const formatDecisions = [];
  const placeholderDecisions = [];
  const endMarkers = [];
  const shadowedFragments = [];
  if (!source.agenda || typeof source.agenda !== "object" || Object.keys(source.agenda).length === 0)
    unresolved.push({ sourcePath, kind: "agenda", message: "No authored agenda dates were found." });
  const occurrences = [];
  const transferRows = [],
    people = new Map(),
    locations = new Map();
  for (const [date, slots] of Object.entries(source.agenda ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [slotIndex, slot] of slots.entries()) {
      let timing;
      try {
        timing = contentAgendaSlotTiming(date, source.timezone, slot, slots[slotIndex + 1], source.transitionMinutes);
      } catch (error) {
        unresolved.push({ sourcePath, date, slotIndex, kind: "time", message: error.message });
        continue;
      }
      // A final title-only slot without a duration marks when the day ends; it is not a session.
      if (
        mappings.archivePublicSource !== true &&
        slotIndex === slots.length - 1 &&
        !slot.sessions?.length &&
        slot.durationMinutes === undefined &&
        !(timing.durationMinutes > 0)
      ) {
        endMarkers.push({ date, time: slot.time, title: slot.title ?? null });
        continue;
      }
      const sessions = slot.sessions?.length
        ? slot.sessions
        : [{ title: slot.title ?? "Break", locations: [], speakers: [], description: "" }];
      for (const [sessionIndex, session] of sessions.entries()) {
        const originalSourceKey = `legacy:${createHash("sha256")
          .update(`${sourcePath}:${date}:${session.id ?? `${slot.time}:${sessionIndex}`}`)
          .digest("hex")}`;
        const resolved = resolveLegacyAgendaRow(
          session,
          {
            sourcePath,
            sourceDigest,
            date,
            slotIndex,
            sessionIndex,
            originalSourceKey,
            title: slot.sessions?.length ? session.title : (session.title ?? slot.title ?? "Break"),
          },
          mappings,
        );
        const { sourceKey, title, names, decisions } = resolved;
        unresolved.push(...resolved.unresolved);
        sourceDecisions.push(...decisions);
        sourceRows.push(resolved.sourceRow);
        const context = { sourceKey, date, time: slot.time, title };
        const presentation = slot.sessions?.length
          ? resolveLegacyAgendaFormat(session, context, mappings)
          : { format: null, track: null, placeholder: false, unresolved: [] };
        unresolved.push(...presentation.unresolved);
        if (presentation.formatDecision) formatDecisions.push(presentation.formatDecision);
        if (presentation.placeholderDecision) placeholderDecisions.push(presentation.placeholderDecision);
        const legacy = slot.sessions?.length
          ? legacyAgendaFragments(
              source,
              session,
              { sourceKey, sourcePath, sourceDigest, date, authoredStart: slot.time },
              roomIds,
            )
          : { fragments: [], unresolved: [] };
        unresolved.push(...legacy.unresolved);
        const legacyDownloads = legacyAgendaDownloads(
          session,
          { sourceKey, sourcePath, sourceDigest },
          mappings.assets,
        );
        const duration = session.durationMinutes ?? timing.durationMinutes;
        const rooms = (session.locations ?? []).map((name) => roomIds[name]);

        const sourceRoles = resolved.sourceRoles;
        const historical = legacyAgendaPeople(
          source,
          names,
          {
            ...mappings,
            speakerUserIds,
            sourcePath,
            sourceDigest,
            sourceRoles,
            sourceCreditDecisions: resolved.creditDecisions,
          },
          context,
        );
        const speakers = historical.people.map((person) => person.canonicalUserId);
        unresolved.push(...historical.unresolved);
        historicalCandidates.push(...historical.candidates);
        for (const name of session.locations ?? [])
          if (!roomIds[name]) unresolved.push({ ...context, kind: "room", value: name });

        const archivalTiming =
          mappings.archivePublicSource === true &&
          (duration === undefined ||
            (duration === 0 && session.durationMinutes === undefined && slot.durationMinutes === undefined))
            ? {
                sourcePath,
                sourceDigest,
                provenance: "authored_public",
                timeZone: source.timezone,
                authoredDate: date,
                authoredStart: slot.time,
                startAt: timing.startsAt,
                endAt: null,
              }
            : null;
        if ((!duration || duration <= 0) && !archivalTiming)
          unresolved.push({
            ...context,
            kind: "duration",
            message: "Supply an explicit positive duration for the final slot.",
          });
        const presentationUrl = session.presentation
          ? (presentationUrls[session.presentation] ??
            (/^https?:\/\//u.test(session.presentation) ? session.presentation : null))
          : null;
        const presentationAsset = mappings.assets?.find(
          (asset) => asset.authoredReference === session.presentation && asset.publicUrl === presentationUrl,
        );
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
        for (const person of historical.people) people.set(person.ref, person);
        for (const name of session.locations ?? [])
          locations.set(name, { ref: name, label: name, canonicalRoomId: roomIds[name] ?? null });
        transferRows.push({
          ref: sourceKey,
          sourceKey,
          sourceAnchor: session.id ?? null,
          sourcePath,
          sourceDigest,
          fields: {
            title: context.title,
            description: session.description ?? "",
            kind: slot.sessions?.length ? "session" : "break",
            track: presentation.track,
            format: presentation.format,
            placeholder: presentation.placeholder,
            visibility: "public",
            admissionPolicy: "preference",
            capacity: null,
            remoteCapacity: null,
          },
          timing: {
            timeZone: source.timezone,
            authoredDate: date,
            authoredStart: slot.time,
            startAt: timing.startsAt,
            endAt:
              duration && duration > 0 ? new Date(Date.parse(timing.startsAt) + duration * 60000).toISOString() : null,
            endSource:
              session.durationMinutes !== undefined || slot.durationMinutes !== undefined
                ? "duration"
                : duration
                  ? "next_start"
                  : "unresolved",
            transitionMinutes: slot.noTransition ? 0 : (source.transitionMinutes ?? 5),
            transitionSource: slot.noTransition
              ? "none"
              : source.transitionMinutes !== undefined
                ? "explicit"
                : "default",
          },
          roomRefs: session.locations ?? [],
          personRefs: names,
          personRoles: Object.fromEntries(historical.people.map((person) => [person.ref, person.role])),
          media: [
            ...(session.presentation
              ? [
                  {
                    kind: "presentation",
                    authoredReference: session.presentation,
                    publicUrl: presentationUrl,
                    sourceDigest: presentationAsset?.sourceDigest ?? mediaDigests[session.presentation] ?? null,
                    bytes: presentationAsset?.bytes ?? null,
                  },
                ]
              : []),
            ...(session.youtube
              ? [
                  {
                    kind: "recording",
                    authoredReference: session.youtube,
                    publicUrl: recordingUrl,
                    sourceDigest: mediaDigests[session.youtube] ?? null,
                  },
                ]
              : []),
          ],
          archive:
            historical.appearances.length ||
            historical.archivalCredits.length ||
            archivalTiming ||
            decisions.length ||
            legacy.fragments.length ||
            legacyDownloads.length
              ? {
                  sourceDecisions: decisions,
                  legacyFragments: legacy.fragments,
                  legacyDownloads,
                  appearances: historical.appearances,
                  archivalCredits: historical.archivalCredits,
                  archivalTiming,
                  materials: [],
                  legacyPaths: [],
                  sessionSlug: null,
                  prerequisites: session.prerequisites ?? "",
                }
              : null,
        });
        if (
          rooms.some((value) => !value) ||
          speakers.some((value) => !value) ||
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
          additionalRoomIds: rooms.slice(1),
          speakerUserIds: [...new Set(speakers)],
          admissionPolicy: "preference",
          capacity: null,
          remoteCapacity: null,
          visibility: "public",
          kind: slot.sessions?.length ? "session" : "break",
          track: presentation.track,
          format: presentation.format,
          placeholder: presentation.placeholder,
        });
      }
    }
  }
  const document = {
    format: "pkic-agenda",
    version: 1,
    source: {
      kind: "hugo",
      eventRef: sourcePath,
      exportedAt: new Date().toISOString(),
      sourceDigest,
    },
    people: [...people.values()],
    rooms: [...locations.values()],
    occurrences: transferRows,
  };
  const keys = new Set();
  const fragmentOwners = new Map();
  for (const row of transferRows) {
    if (keys.has(row.sourceKey))
      unresolved.push({
        sourceKey: row.sourceKey,
        kind: "source_key",
        message: "Map colliding authored row locators to distinct reviewed source keys.",
      });
    keys.add(row.sourceKey);
    if (row.archive?.legacyFragments && mappings.archivePublicSource !== true) {
      // Hugo rendered every day on one page, so a repeated anchor only ever reached its first
      // occurrence in date order. Later duplicates were unreachable and are recorded, not kept.
      row.archive.legacyFragments = row.archive.legacyFragments.filter((fragment) => {
        const owner = fragmentOwners.get(fragment.anchor);
        if (owner && owner !== row.sourceKey) {
          shadowedFragments.push({ sourceKey: row.sourceKey, anchor: fragment.anchor, reachableFrom: owner });
          return false;
        }
        return true;
      });
    }
    for (const fragment of row.archive?.legacyFragments ?? []) {
      if (fragmentOwners.has(fragment.anchor) && fragmentOwners.get(fragment.anchor) !== row.sourceKey)
        unresolved.push({
          kind: "legacy_fragment",
          sourceKey: row.sourceKey,
          value: fragment.anchor,
          message: "Resolve colliding authored legacy fragments before importing.",
        });
      if (!fragmentOwners.has(fragment.anchor)) fragmentOwners.set(fragment.anchor, row.sourceKey);
    }
  }
  const locators = new Set(sourceRows.map((row) => row.sourceLocator));
  for (const locator of Object.keys(mappings.sourceRows ?? {}))
    if (!locators.has(locator))
      unresolved.push({
        kind: "source_decision",
        sourceLocator: locator,
        message: "The reviewed row locator is absent from this source.",
      });
  unresolved.push(...validateLegacyAgendaDocument(document));
  return {
    document,
    historicalCandidates,
    sourceDecisions,
    sourceRows,
    formatDecisions,
    placeholderDecisions,
    endMarkers,
    shadowedFragments,
    payload: { source: "legacy", dryRun: true, expectedRevision, occurrences },
    unresolved,
    ready: unresolved.length === 0,
  };
}
