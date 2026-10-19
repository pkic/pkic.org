import { clockTimeZone, type ClockZone } from "../../../../../../../shared/event-clock";
import type { EventScanRequest, ScannerTarget } from "../../../../../../../shared/schemas/event-participation-scanning";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";

/** What the scanner records into: the sponsor's leads, or the selected session or entrance and its room. */
export function scannerContextLabel({
  action,
  sponsorName,
  targetId,
  targetLabel,
  roomId,
  rooms,
}: {
  action: EventScanRequest["action"];
  sponsorName?: string;
  targetId: string | null;
  targetLabel: string;
  roomId: string | null;
  rooms: ReadonlyArray<{ id: string; name: string }>;
}): string {
  if (action === "lead") return `${sponsorName || "Sponsor lead capture"} · Event-wide`;
  const place = targetLabel || (targetId ? "Session check-in" : "Event entrance");
  return roomId ? `${place} · ${rooms.find((room) => room.id === roomId)?.name ?? "Room"}` : place;
}

/** Identify the capture purpose and selected room/session before scanning starts. */
export function ScannerCaptureContext({
  contextLabel,
  target,
  timeZone,
}: {
  contextLabel: string;
  target: ScannerTarget | null;
  /** The event's clock the session times are on. */
  timeZone: ClockZone | null;
}) {
  return (
    <div class="pk-stack pk-stack--snug">
      <strong>{contextLabel}</strong>
      {target?.startAt && timeZone && (
        <p class="pk-muted">
          {formatDateTimeInZone(target.startAt, timeZone)}
          {target.endAt ? ` – ${formatDateTimeInZone(target.endAt, timeZone)}` : " · End time not scheduled"} ·{" "}
          {clockTimeZone(timeZone)}
        </p>
      )}
    </div>
  );
}
