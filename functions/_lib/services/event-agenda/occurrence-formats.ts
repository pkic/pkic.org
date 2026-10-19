import { configuredAgendaSessionFormat } from "../../../../assets/shared/event-agenda-format";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { resolveEventSessionTypes } from "../event-presentation";

/** The event's configured session type labels; agenda formats reference these, never a table CHECK. */
export async function readAgendaSessionFormatLabels(db: DatabaseLike, eventId: string): Promise<string[]> {
  const event = await first<{ settings_json: string | null }>(db, "SELECT settings_json FROM events WHERE id=?", [
    eventId,
  ]);
  return resolveEventSessionTypes(event?.settings_json ?? "{}").map((sessionType) => sessionType.label);
}

/** Every written format must name a configured session type; the stored value is the canonical configured label. */
export function canonicalAgendaSessionFormats<T extends { title: string; format?: string | null }>(
  labels: readonly string[],
  items: readonly T[],
): T[] {
  const unconfigured = items.filter((item) => item.format && !configuredAgendaSessionFormat(labels, item.format));
  if (unconfigured.length) {
    const message = "Choose a session format configured for this event";
    throw new AppError(422, "AGENDA_FORMAT_NOT_CONFIGURED", message, {
      formErrors: unconfigured.map((item) => `${item.title}: ${message.toLocaleLowerCase("en-US")}`),
      fieldErrors: { format: [message] },
      allowedFormats: [...labels],
    });
  }
  return items.map((item) =>
    item.format ? { ...item, format: configuredAgendaSessionFormat(labels, item.format) } : item,
  );
}
