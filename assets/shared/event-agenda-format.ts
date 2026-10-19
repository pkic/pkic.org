import { sessionTypeName, type ProposalSessionType } from "./proposal-session-types";
import type { AgendaSessionFormatOption } from "./schemas/event-agenda";

function normalizedFormat(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

/** Readable label for a configured session type identifier, e.g. `lightning_talk` -> `Lightning talk`. */
export function agendaSessionFormatLabel(value: string): string {
  return sessionTypeName({ label: value });
}

/** Agenda format options derived from the event's configured session type labels. */
export function agendaSessionFormatOptions(
  labels: readonly (string | ProposalSessionType)[],
): AgendaSessionFormatOption[] {
  return labels.map((type) =>
    typeof type === "string"
      ? { id: type, label: agendaSessionFormatLabel(type) }
      : { id: type.label, label: sessionTypeName(type) },
  );
}

/** The canonical configured label for a format, matched case-insensitively, or null when it is not configured. */
export function configuredAgendaSessionFormat(labels: readonly string[], value: string): string | null {
  const requested = normalizedFormat(value);
  return labels.find((label) => normalizedFormat(label) === requested) ?? null;
}

/** Public format projection: the configured option's label, or a readable fallback for a retired type. */
export function agendaSessionFormatContent(
  formats: readonly AgendaSessionFormatOption[] | undefined,
  value: string | null | undefined,
): AgendaSessionFormatOption | undefined {
  if (!value) return undefined;
  const requested = normalizedFormat(value);
  return (
    formats?.find((format) => normalizedFormat(format.id) === requested) ?? {
      id: value,
      label: agendaSessionFormatLabel(value),
    }
  );
}
