/**
 * The event app's check-in page. Without a code it opens the camera; with one
 * (from the in-app camera or a phone camera opening the printed link) it shows
 * what scanning does — "Check in to Day 1", "Check in to <session>", "Check out
 * of Day 1" — and records it only when the attendee confirms. Anyone signed in
 * is checked in; a note says when they are not registered for the day, attend
 * it online, or have no seat booked for the session.
 */
import { useMemo, useState } from "preact/hooks";
import { contractClock } from "../../../../../../shared/event-clock";
import { formatCalendarDate, formatClockRangeInZone } from "../../../../../../shared/format-date";
import {
  attendancePointResultSchema,
  attendancePointTokenSchema,
  type AttendancePointResult,
  type AttendancePointTarget,
} from "../../../../../../shared/schemas/event-attendance-points";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { useData } from "../../../../../hooks/useData";
import { getJson, postJson } from "../../../../../shared/api-client";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { usePortalHashLocation } from "../../../hash-location";
import { eventCheckInPath } from "../event-participant-paths";
import { CheckInScanner } from "./CheckInScanner";
import { EventCard } from "./EventCard";
import { checkInActionLabel, checkInHeading, checkInNotes, checkInOutcome } from "./check-in-copy";

const href = usePortalHashLocation.hrefs;

export function EventCheckIn({ slug, pointToken }: { slug: string; pointToken?: string }) {
  const [, navigate] = usePortalHashLocation();
  if (!pointToken)
    return (
      <EventCard eyebrow="Check-in" title="Scan a check-in code">
        <CheckInScanner onPoint={(point) => navigate(eventCheckInPath(point.eventSlug, point.token))} />
      </EventCard>
    );
  return <CheckInConfirmation key={pointToken} slug={slug} token={pointToken} />;
}

const INVALID: AttendancePointResult = {
  status: "refused",
  reason: "invalid_code",
  target: null,
  recordedAt: null,
  standing: null,
  booked: null,
};

function CheckInConfirmation({ slug, token }: { slug: string; token: string }) {
  const valid = attendancePointTokenSchema.safeParse(token).success;
  const preview = useData(
    () =>
      valid
        ? getJson(
            `/api/v1/events/${encodeURIComponent(slug)}/attendance/points/${encodeURIComponent(token)}`,
            attendancePointResultSchema,
          )
        : Promise.resolve(INVALID),
    [slug, token],
  );
  const operationId = useMemo(() => crypto.randomUUID(), [token]);
  const [recorded, setRecorded] = useState<AttendancePointResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (preview.loading) return <Spinner label="Reading the code…" />;
  if (!preview.data) return <ErrorAlert error={preview.error ?? "Could not read the code."} />;
  const shown = recorded ?? preview.data;
  async function confirm(target: AttendancePointTarget) {
    setSaving(true);
    setError("");
    try {
      setRecorded(
        await postJson(
          `/api/v1/events/${encodeURIComponent(slug)}/attendance/${target.action === "check_out" ? "check-outs" : "check-ins"}`,
          { pointToken: token, operationId },
          attendancePointResultSchema,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the check-in. Try again.");
    } finally {
      setSaving(false);
    }
  }
  if (shown.status === "ready" && shown.target) {
    const target = shown.target;
    return (
      <EventCard eyebrow={target.action === "check_out" ? "Check-out" : "Check-in"} title={checkInHeading(target)}>
        <TargetDetails target={target} />
        <CheckInNotes result={shown} recorded={false} />
        {error && <ErrorAlert error={error} />}
        <div class="pk-cluster">
          <Button variant="primary" loading={saving} onClick={() => void confirm(target)}>
            {checkInActionLabel(target)}
          </Button>
        </div>
      </EventCard>
    );
  }
  return <CheckInOutcome slug={slug} result={shown} />;
}

function TargetDetails({ target }: { target: AttendancePointTarget }) {
  const clock = contractClock(target);
  // The heading already names the day; the date says which one it is.
  if (!target.session) return <p class="pk-event-card__meta">{formatCalendarDate(target.dayDate)}</p>;
  return (
    <>
      <p class="pk-event-card__meta">
        {target.dayLabel}, {formatClockRangeInZone(target.session.startAt, target.session.endAt, clock)}
      </p>
      {(target.session.room ?? target.room) && (
        <p class="pk-event-card__meta">{(target.session.room ?? target.room)!.name}</p>
      )}
    </>
  );
}

function CheckInNotes({ result, recorded }: { result: AttendancePointResult; recorded: boolean }) {
  return (
    <>
      {checkInNotes(result, recorded).map((note) => (
        <Alert key={note.text} tone={note.tone}>
          {note.text}
        </Alert>
      ))}
    </>
  );
}

function CheckInOutcome({ slug, result }: { slug: string; result: AttendancePointResult }) {
  const copy = checkInOutcome(result);
  const next = (
    <div class="pk-cluster">
      <a href={href(eventCheckInPath(slug))}>Scan another code</a>
    </div>
  );
  if (copy.refused)
    return (
      <Alert tone="warn" title={copy.title}>
        <p>{copy.body}</p>
        {next}
      </Alert>
    );
  return (
    <EventCard eyebrow={result.status.endsWith("checked_out") ? "Check-out" : "Check-in"} title={copy.title}>
      <p>{copy.body}</p>
      {result.target?.session && <TargetDetails target={result.target} />}
      <CheckInNotes result={result} recorded />
      {next}
    </EventCard>
  );
}
