import { authoredAgendaSessionFragments } from "../../assets/shared/legacy-agenda-fragments.ts";
import { legacyAgendaFragmentAnchorSchema } from "../../assets/shared/schemas/event-session-history.ts";

/** Original Hugo IDs derive from authored title, clock spelling and day-specific room order. */
export function legacyAgendaFragments(source, session, context, roomIds) {
  const order = (source.locations?.[context.date] ?? source.locations)?.order;
  const fragments = [],
    unresolved = [];
  // No authored column order means there is no evidence for a historical Hugo dialog ID.
  if (!Array.isArray(order)) return { fragments, unresolved };
  for (const roomRef of session.locations ?? []) {
    const locationIndex = order.indexOf(roomRef);
    if (locationIndex < 0 || order.lastIndexOf(roomRef) !== locationIndex) {
      unresolved.push({
        kind: "legacy_fragment",
        sourceKey: context.sourceKey,
        value: roomRef,
        message: "Resolve the missing or duplicate authored room column before preserving its legacy fragments.",
      });
      continue;
    }
    const generated = authoredAgendaSessionFragments(context.authoredStart, session.title ?? null, [roomRef], order);
    if (!generated.length)
      unresolved.push({
        kind: "legacy_fragment",
        sourceKey: context.sourceKey,
        value: roomRef,
        message: "The authored legacy fragment is outside the safe fragment contract.",
      });
    for (const { kind, anchor: value } of generated) {
      if (!legacyAgendaFragmentAnchorSchema.safeParse(value).success) {
        unresolved.push({
          kind: "legacy_fragment",
          sourceKey: context.sourceKey,
          value,
          message: "The authored legacy fragment is outside the safe fragment contract.",
        });
        continue;
      }
      fragments.push({
        anchor: value,
        kind,
        roomRef,
        roomId: roomIds[roomRef] ?? null,
        sourcePath: context.sourcePath,
        sourceDigest: context.sourceDigest,
        sourceLocator: context.sourceKey,
        authoredDate: context.date,
        authoredStart: context.authoredStart,
        authoredTitle: session.title ?? null,
      });
    }
  }
  return { fragments, unresolved };
}
