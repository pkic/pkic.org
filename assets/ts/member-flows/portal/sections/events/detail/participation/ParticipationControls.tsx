import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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
import { PreferenceStar } from "../../../../../../ui/PreferenceStar";
import { Button } from "../../../../../../ui/Button";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
type Session = z.infer<typeof personalAgendaSessionSchema>;
type BookingAction = "reserve" | "request";
const ACTION_LABELS: Record<BookingAction, string> = {
  reserve: "Reserve a place",
  request: "Request approval",
};
const ACTIVE_STATUSES = ["reserved", "approval_pending", "waitlisted"];
/**
 * The booking command a session's policy offers. Canceling is never one of
 * them: it is a separate, confirmed action, so changing only the attendance
 * mode or location can never release a place.
 */
function bookingActions(policy: Session["admissionPolicy"]): BookingAction[] {
  return policy === "preference" ? [] : policy === "approval" ? ["request"] : ["reserve"];
}
export function ParticipationControls({
  slug,
  session,
  onSaved,
  preference = true,
}: {
  slug: string;
  session: Session;
  onSaved: () => void;
  /** The shared agenda details already carry the star; they omit this duplicate. */
  preference?: boolean;
}) {
  const actions = bookingActions(session.admissionPolicy);
  const [action, setAction] = useState<BookingAction>(session.admissionPolicy === "approval" ? "request" : "reserve");
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
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refusedRevision, setRefusedRevision] = useState<number | null>(null);
  const form = useContractForm(sessionParticipationRequestSchema, {
    action,
    expectedPublishedRevision: session.publishedRevision,
    attendanceMode,
    roomId: attendanceMode === "physical" ? roomId : null,
    replaceOccurrenceId: action === "reserve" ? replacement?.id : undefined,
  });
  const preferenceForm = useContractForm(sessionParticipationRequestSchema, {
    action: session.saved ? "unsave" : "save",
    attendanceMode,
    roomId: attendanceMode === "physical" ? roomId : null,
  });
  // Canceling releases the place the viewer already holds, so it carries that
  // place rather than whatever the location fields currently show.
  const cancelForm = useContractForm(sessionParticipationRequestSchema, {
    action: "cancel",
    attendanceMode: session.attendanceMode ?? attendanceMode,
    roomId: (session.attendanceMode ?? attendanceMode) === "physical" ? (session.roomId ?? null) : null,
  });
  const registered = ACTIVE_STATUSES.includes(session.status ?? "");
  const registrationControls = actions.length > 0;
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
  const actionAllowed = availability?.bookingAction === action;
  const changingConfirmedPlace =
    session.status === "reserved" && (attendanceMode !== session.attendanceMode || roomId !== session.roomId);
  const canSubmit =
    refusedRevision !== session.publishedRevision &&
    actionAllowed &&
    !(availability?.state === "full" && changingConfirmedPlace);
  async function submit(event: Event) {
    event.preventDefault();
    if (!registrationControls || running.current) return;
    if (!canSubmit) {
      setError(availability?.message ?? "Choose a location and refresh availability before registering.");
      return;
    }
    await apply(form.submit(), form.refuse);
  }
  async function cancelRegistration() {
    if (running.current) return;
    const confirmed = await confirmAction({
      title: `Cancel your registration for ${session.title}?`,
      consequences: [
        session.status === "waitlisted"
          ? "You leave the waiting list"
          : session.status === "approval_pending"
            ? "Your approval request is withdrawn"
            : "Your place is released and may go to the next person on the waiting list",
        "Registering again depends on the availability at that time",
      ],
      confirmLabel: "Cancel registration",
      cancelLabel: "Keep registration",
      tone: "danger",
    });
    if (!confirmed) return;
    await apply(cancelForm.submit(), cancelForm.refuse);
  }
  async function apply(checked: ReturnType<typeof form.submit>, refuse: typeof form.refuse) {
    if (running.current) return;
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    running.current = true;
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
      setError(refuse(error));
      if (
        (checked.data.action === "reserve" || checked.data.action === "request") &&
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === "SESSION_PUBLICATION_CHANGED"
      ) {
        setRefusedRevision(session.publishedRevision);
        onSaved();
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <form class="pk-stack" noValidate {...form.handlers} onSubmit={submit}>
      {preference && (
        <div class="pk-cluster">
          <Button
            type="button"
            icon
            variant="ghost"
            aria-label={session.saved ? "Remove preference" : "Save preference"}
            title={session.saved ? "Remove saved preference" : "Save preference; this does not reserve a place"}
            aria-pressed={session.saved}
            loading={busy}
            onClick={() => void apply(preferenceForm.submit(), preferenceForm.refuse)}
          >
            <PreferenceStar selected={session.saved} />
          </Button>
          <small>Saving interest does not reserve a place.</small>
        </div>
      )}
      <p role="status">
        <strong>{availability ? PARTICIPATION_AVAILABILITY_LABELS[availability.state] : "Choose a location"}</strong>{" "}
        {availability?.message ??
          "Choose an attendance location to check session registration. You can still save a preference."}
      </p>
      {registrationControls && (
        <Field label="Participation" {...form.of("action")}>
          {(control) => (
            <Select
              {...control}
              name="action"
              value={action}
              onChange={(event) => setAction(event.currentTarget.value as typeof action)}
            >
              {actions.map((value) => (
                <option value={value} disabled={availability?.bookingAction !== value}>
                  {value === "reserve" && availability?.state === "full" ? "Join waiting list" : ACTION_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
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
      {(registrationControls || registered) && (
        <div class="pk-cluster">
          {registrationControls && (
            <Button type="submit" loading={busy} disabled={!canSubmit}>
              Update
            </Button>
          )}
          {registered && (
            <Button type="button" variant="danger-quiet" disabled={busy} onClick={() => void cancelRegistration()}>
              Cancel my session registration…
            </Button>
          )}
        </div>
      )}
      {error && <ErrorAlert error={error} />}
    </form>
  );
}
