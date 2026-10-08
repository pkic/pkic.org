import { useEffect, useRef, useState } from "preact/hooks";
import {
  scannerTargetsResponseSchema,
  type ScannerTarget,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
/** Session metadata is resolved once outside the scan hot path; a room choice belongs to this target. */
export function useScannerLocation(
  slug: string,
  initialId: string | null,
  enabled: boolean,
  onContextChange: () => void,
  collector?: ScannerOfflineContext,
) {
  const [targetId, setTarget] = useState(initialId),
    [targetLabel, setLabel] = useState(""),
    [target, setMetadata] = useState<ScannerTarget | null>(null),
    [timeZone, setTimeZone] = useState<string | null>(null),
    [rooms, setRooms] = useState<NonNullable<ScannerTarget["rooms"]>>([]),
    [roomId, setRoom] = useState<string | null>(null);
  const current = useRef(targetId);
  current.current = targetId;
  const changed = useRef(onContextChange);
  changed.current = onContextChange;
  function selectTarget(item: ScannerTarget | null) {
    changed.current();
    setTarget(item?.id ?? null);
    setMetadata(item);
    setLabel(item?.title ?? "");
    const locations = item?.rooms ?? [];
    setRooms(locations);
    setRoom(locations.length === 1 ? locations[0]!.id : null);
  }
  function selectRoom(id: string | null) {
    changed.current();
    setRoom(id);
  }
  useEffect(() => {
    if (collector || !enabled || !initialId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const query = new URLSearchParams({ occurrenceId: initialId, limit: "1" });
        const response = await fetch(`/api/v1/events/${encodeURIComponent(slug)}/scans/targets?${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = scannerTargetsResponseSchema.parse(await response.json());
        if (!controller.signal.aborted && current.current === initialId && result.sessions[0]) {
          setTimeZone(result.timeZone);
          selectTarget(result.sessions[0]);
        }
      } catch {
        /* Explicit target selection remains available when metadata preparation is interrupted. */
      }
    })();
    return () => controller.abort();
  }, [slug, initialId, enabled, collector?.epochId]);
  // Lead capture is event-wide. Retain the prior check-in choice for a return to that mode.
  return {
    timeZone,
    setTimeZone,
    target: enabled && !collector ? target : null,
    targetId: collector ? collector.occurrenceId : enabled ? targetId : null,
    targetLabel: collector
      ? collector.occurrenceId
        ? "Prepared session"
        : "Event entrance"
      : enabled
        ? targetLabel
        : "",
    rooms: collector
      ? collector.roomId
        ? [{ id: collector.roomId, name: "Prepared room" }]
        : []
      : enabled
        ? rooms
        : [],
    roomId: collector ? (collector.roomId ?? null) : enabled ? roomId : null,
    selectTarget,
    selectRoom,
  };
}
