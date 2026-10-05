import { useEffect, useMemo, useState } from "preact/hooks";
import type { z } from "zod";
import {
  personalAgendaResponseSchema,
  personalAgendaSessionSchema,
} from "../../../../../../../shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { PARTICIPATION_AVAILABILITY_LABELS } from "../../../../../../../shared/event-participation-availability";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ApiClientError, putJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
type Session = z.infer<typeof personalAgendaSessionSchema>;
const ACTION_LABELS = {
  save: "Save preference",
  unsave: "Remove preference",
  reserve: "Reserve a place",
  request: "Request approval",
  cancel: "Cancel session registration",
};
export function ParticipationControls({
  slug,
  session,
  onSaved,
}: {
  slug: string;
  session: Session;
  onSaved: () => void;
}) {
  const [action, setAction] = useState<z.infer<typeof sessionParticipationRequestSchema>["action"]>("save");
  const [attendanceMode, setMode] = useState<"physical" | "remote">(session.attendanceMode ?? "physical");
  const [roomId, setRoomId] = useState<string | null>(
    session.roomId ?? (session.rooms.length === 1 ? session.rooms[0]!.id : null),
  );
  const [replacement, setReplacement] = useState<Session | null>(null);
  const reservations = useMemo(
    () => ({
      endpoint: `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation`,
      responseSchema: personalAgendaResponseSchema,
      resolveItems: (response: z.infer<typeof personalAgendaResponseSchema>) => response.sessions,
      resolvePage: (response: z.infer<typeof personalAgendaResponseSchema>) => response.page,
      itemKey: (item: Session) => item.id,
      itemLabel: (item: Session) => item.title,
      params: { status: "reserved" },
      sort: "startAt",
    }),
    [slug],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refusedRevision, setRefusedRevision] = useState<number | null>(null);
  const booking = action === "reserve" || action === "request";
  const form = useContractForm(sessionParticipationRequestSchema, {
    action,
    expectedPublishedRevision: booking ? session.publishedRevision : undefined,
    attendanceMode,
    roomId: attendanceMode === "physical" ? roomId : null,
    replaceOccurrenceId: action === "reserve" ? replacement?.id : undefined,
  });
  useEffect(() => {
    if (refusedRevision === null || session.publishedRevision === refusedRevision) return;
    setMode(session.attendanceMode ?? "physical");
    setRoomId(session.roomId ?? (session.rooms.length === 1 ? session.rooms[0]!.id : null));
    setReplacement(null);
    form.reset();
    setRefusedRevision(null);
  }, [refusedRevision, session.publishedRevision, session.attendanceMode, session.roomId, session.rooms, form.reset]);
  const availability = session.availability.find(
    (item) => item.attendanceMode === attendanceMode && (attendanceMode === "remote" || item.roomId === roomId),
  );
  const actionAllowed = (action !== "reserve" && action !== "request") || availability?.bookingAction === action;
  const changingConfirmedPlace =
    session.status === "reserved" && (attendanceMode !== session.attendanceMode || roomId !== session.roomId);
  const canSubmit =
    !(booking && refusedRevision === session.publishedRevision) &&
    actionAllowed &&
    !(availability?.state === "full" && changingConfirmedPlace && (action === "reserve" || action === "request"));
  async function submit(event: Event) {
    event.preventDefault();
    if (!canSubmit) {
      setError(availability?.message ?? "Choose a location and refresh availability before registering.");
      return;
    }
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await putJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/${session.id}/participation`,
        checked.data,
        sessionParticipationResponseSchema,
      );
      onSaved();
    } catch (error) {
      setError(form.refuse(error));
      if (
        booking &&
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === "SESSION_PUBLICATION_CHANGED"
      ) {
        setRefusedRevision(session.publishedRevision);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form class="pk-stack" noValidate {...form.handlers} onSubmit={submit}>
      <p role="status">
        <strong>{availability ? PARTICIPATION_AVAILABILITY_LABELS[availability.state] : "Choose a location"}</strong>{" "}
        {availability?.message ??
          "Choose an attendance location to check session registration. You can still save a preference."}
      </p>
      <Field label="Participation" {...form.of("action")}>
        {(control) => (
          <Select
            {...control}
            name="action"
            value={action}
            onChange={(event) => setAction(event.currentTarget.value as typeof action)}
          >
            {sessionParticipationRequestSchema.shape.action.options
              .filter(
                (value) =>
                  (value !== "request" || session.admissionPolicy === "approval") &&
                  (value !== "reserve" || session.admissionPolicy !== "preference"),
              )
              .map((value) => (
                <option
                  value={value}
                  disabled={(value === "reserve" || value === "request") && availability?.bookingAction !== value}
                >
                  {value === "reserve" && availability?.state === "full" ? "Join waiting list" : ACTION_LABELS[value]}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Attendance" {...form.of("attendanceMode")}>
        {(control) => (
          <Select
            {...control}
            name="attendanceMode"
            value={attendanceMode}
            onChange={(event) => setMode(event.currentTarget.value as typeof attendanceMode)}
          >
            {sessionParticipationRequestSchema.shape.attendanceMode.options.map((value) => (
              <option value={value}>{value === "physical" ? "In person" : "Remote"}</option>
            ))}
          </Select>
        )}
      </Field>
      {attendanceMode === "physical" && session.rooms.length > 1 && (
        <Field label="Location" {...form.of("roomId")}>
          {(control) => (
            <Select
              {...control}
              name="roomId"
              value={roomId ?? ""}
              onChange={(event) => setRoomId(event.currentTarget.value || null)}
            >
              <option value="">Choose a location</option>
              {session.rooms.map((room) => (
                <option value={room.id}>{room.name}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {action === "reserve" && (
        <Field
          label="Replace a confirmed reservation"
          help="Optional. Your old place is released only after the new place is confirmed."
          {...form.of("replaceOccurrenceId")}
        >
          {(control) => (
            <ServerSearchSelect
              {...control}
              catalog={reservations}
              searchLabel="Confirmed reservation"
              value={replacement?.id ?? null}
              selectedLabel={replacement?.title}
              excludeValues={[session.id]}
              onChange={setReplacement}
              placeholder="Keep my existing reservations"
            />
          )}
        </Field>
      )}
      <Button type="submit" loading={busy} disabled={!canSubmit}>
        Update
      </Button>
      {error && <ErrorAlert error={error} />}
    </form>
  );
}
