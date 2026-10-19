/**
 * Reviewed session format and placeholder decisions for one authored session.
 *
 * Formats come only from an explicit `formats` mapping (authored value -> configured session type label)
 * or from an authored `format`/`type` value that exactly names a configured label. A mapped `track` value
 * becomes the format and is no longer kept as the subject track. Nothing is guessed from free text.
 */
export function resolveLegacyAgendaFormat(session, context, mappings) {
  const formats = mappings.formats ?? {};
  const configured = Array.isArray(mappings.event?.sessionTypes) ? mappings.event.sessionTypes : null;
  const unresolved = [];
  const track = typeof session.track === "string" ? session.track.trim() || null : null;
  const authoredFormat = [
    ["format", session.format],
    ["type", session.type],
  ].find(([, value]) => typeof value === "string" && value.trim());
  let authored = null;
  let mapped = null;
  let keepTrack = track;
  if (authoredFormat) {
    authored = { field: authoredFormat[0], value: authoredFormat[1].trim() };
    mapped = Object.hasOwn(formats, authored.value)
      ? formats[authored.value]
      : configured?.some((label) => label.toLocaleLowerCase("en-US") === authored.value.toLocaleLowerCase("en-US"))
        ? authored.value
        : null;
    if (!mapped)
      unresolved.push({
        ...context,
        kind: "format",
        value: authored.value,
        message: `Map the authored ${authored.field} to a configured session type in reviewed formats.`,
      });
  } else if (track && Object.hasOwn(formats, track)) {
    authored = { field: "track", value: track };
    mapped = formats[track];
    keepTrack = null;
  }
  let format = null;
  if (mapped) {
    const label = configured?.find((value) => value.toLocaleLowerCase("en-US") === mapped.toLocaleLowerCase("en-US"));
    if (!configured)
      unresolved.push({
        ...context,
        kind: "format",
        value: mapped,
        message: "List the target event's configured session types in event.sessionTypes to verify format mappings.",
      });
    else if (!label)
      unresolved.push({
        ...context,
        kind: "format",
        value: mapped,
        message: `The mapped format is not a configured session type of the target event (${configured.join(", ")}).`,
      });
    format = label ?? mapped;
  }
  const placeholderTitles = new Set(
    (mappings.placeholderTitles ?? []).map((title) => String(title).trim().toLocaleLowerCase("en-US")),
  );
  const placeholder =
    !(session.speakers ?? []).length &&
    placeholderTitles.has(
      String(context.title ?? "")
        .trim()
        .toLocaleLowerCase("en-US"),
    );
  return {
    format,
    track: keepTrack,
    placeholder,
    formatDecision: authored
      ? { ...context, authoredField: authored.field, authoredValue: authored.value, format, trackRetained: keepTrack }
      : null,
    placeholderDecision: placeholder ? { ...context, placeholder: true, reason: "placeholderTitles" } : null,
    unresolved,
  };
}
