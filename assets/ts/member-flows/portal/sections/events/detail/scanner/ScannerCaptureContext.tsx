import type { EventScanRequest, ScannerTarget } from "../../../../../../../shared/schemas/event-participation-scanning";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";

/** Identify the capture purpose and selected room/session before scanning starts. */
export function ScannerCaptureContext({
  action,
  contextLabel,
  target,
  timeZone,
}: {
  action: EventScanRequest["action"];
  contextLabel: string;
  target: ScannerTarget | null;
  timeZone: string | null;
}) {
  return (
    <div class="pk-stack pk-stack--snug">
      <strong>{action === "lead" ? "Sponsor lead capture · event-wide" : contextLabel}</strong>
      {target?.startAt && timeZone && (
        <p class="pk-muted">
          {formatDateTimeInZone(target.startAt, timeZone)}
          {target.endAt ? ` – ${formatDateTimeInZone(target.endAt, timeZone)}` : " · End time not scheduled"} ·{" "}
          {timeZone}
        </p>
      )}
      <p class="pk-muted">No attendee names or contact details are stored on this device.</p>
    </div>
  );
}
