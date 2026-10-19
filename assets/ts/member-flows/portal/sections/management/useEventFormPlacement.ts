import { useCallback, useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { groupEventFormResponseSchema } from "../../../../../shared/schemas/group-event-forms";
import type { EventFormsPurpose } from "../../../../../shared/schemas/forms";
import { getJson } from "../../../../shared/api-client";

export type EventFormPlacement = z.infer<typeof groupEventFormResponseSchema>;

/** The address of one event flow's form placement; the GET, PUT and PATCH of that flow all live here. */
export function eventFormPlacementPath(groupId: string, eventId: string, purpose: EventFormsPurpose): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/forms/${purpose}`;
}

/**
 * Loads the form placed in one event flow, and keeps the latest copy the
 * caller saved. The Settings editor and the Proposals tab's call-for-proposals
 * panel read the placement through this, so neither has its own fetch.
 *
 * `enabled` false skips the request, for a reader who cannot manage the event.
 */
export function useEventFormPlacement(groupId: string, eventId: string, purpose: EventFormsPurpose, enabled = true) {
  const base = eventFormPlacementPath(groupId, eventId, purpose);
  const [placement, setPlacement] = useState<EventFormPlacement | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setPlacement(await getJson(base, groupEventFormResponseSchema));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { base, placement, setPlacement, loading, error, setError, reload: load };
}

/** Whether the portal owns this event's form placements; a website-defined event's are not changed here. */
export function canConfigureEventForms(event: { sourceMode: string | null }): boolean {
  return event.sourceMode === "portal";
}
