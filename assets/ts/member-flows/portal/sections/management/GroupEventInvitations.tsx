import { useEffect, useRef, useState } from "preact/hooks";
import {
  eventAttendeeInvitesListResponseSchema,
  eventInviteResendResponseSchema,
  type EventAttendeeInviteSummary,
} from "../../../../../shared/schemas/event-invites";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../shared/timezone";

type InviteStatusFilter = "" | EventAttendeeInviteSummary["status"];

const INVITE_STATUS_FILTERS: ReadonlyArray<{ value: InviteStatusFilter; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

function inviteeLabel(invite: EventAttendeeInviteSummary): string {
  const name = [invite.inviteeFirstName, invite.inviteeLastName].filter(Boolean).join(" ");
  return name || invite.inviteeEmail;
}

/**
 * Selected-group attendee invitation lifecycle. The server remains the source
 * of truth for whether a specific invitation may be resent or revoked.
 */
export function GroupEventInvitations({ groupId, event }: { groupId: string; event: GroupEvent }) {
  const tableActions = useRef<ApiTableActions | null>(null);
  const [status, setStatus] = useState<InviteStatusFilter>("");
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(() =>
    event.startsAt ? instantToDateTimeLocal(event.startsAt, event.timezone) : "",
  );
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/invites`;
  const latestExpiry = event.endsAt ? instantToDateTimeLocal(event.endsAt, event.timezone) : undefined;

  useEffect(() => {
    setExpiresAt(event.startsAt ? instantToDateTimeLocal(event.startsAt, event.timezone) : "");
  }, [event.startsAt, event.timezone]);

  async function runAction(invite: EventAttendeeInviteSummary, action: "resend" | "revoke"): Promise<void> {
    if (
      action === "revoke" &&
      !window.confirm(`Revoke the invitation for ${inviteeLabel(invite)}? They will no longer be able to accept it.`)
    ) {
      return;
    }

    setBusyInviteId(invite.id);
    setError(null);
    setMessage(null);
    try {
      if (action === "resend") {
        if (!expiresAt) throw new Error("Set an invitation deadline before resending.");
        await postJson(
          `${endpoint}/${encodeURIComponent(invite.id)}/resend`,
          { expiresAt: dateTimeLocalToIso(expiresAt, event.timezone) },
          eventInviteResendResponseSchema,
        );
        setMessage(`Invitation resent to ${inviteeLabel(invite)}.`);
      } else {
        await postJson(`${endpoint}/${encodeURIComponent(invite.id)}/revoke`, {}, successResponseSchema);
        setMessage(`Invitation revoked for ${inviteeLabel(invite)}.`);
      }
      await tableActions.current?.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(`Unable to ${action} the invitation.`));
    } finally {
      setBusyInviteId(null);
    }
  }

  return (
    <section class="border-top pt-3" aria-label="Attendee invitations">
      <h6 class="small fw-semibold">Attendee invitations</h6>
      <div class="mb-3">
        <label class="form-label small fw-semibold" for={`group-event-invite-deadline-${event.id}`}>
          Resend deadline
        </label>
        <input
          id={`group-event-invite-deadline-${event.id}`}
          class="form-control form-control-sm"
          type="datetime-local"
          value={expiresAt}
          max={latestExpiry}
          onInput={(inputEvent) => setExpiresAt((inputEvent.target as HTMLInputElement).value)}
        />
        <div class="form-text">
          Defaults to the event start and cannot be later than the event end
          {latestExpiry ? ` (${latestExpiry.replace("T", " ")} ${event.timezone})` : ""}.
        </div>
      </div>
      {message && (
        <div class="alert alert-success small py-2" role="status" aria-live="polite">
          {message}
        </div>
      )}
      <ErrorAlert error={error} />
      <ApiDataTable
        actionsRef={tableActions}
        endpoint={endpoint}
        responseSchema={eventAttendeeInvitesListResponseSchema}
        resolve={(response) => response.invites}
        resolvePage={(response) => response.page}
        paginate
        searchPlaceholder="Search invitations…"
        initialSort="-created_at"
        params={status ? { status } : undefined}
        toolbar={({ resetPage }) => (
          <select
            class="form-select form-select-sm w-auto"
            aria-label="Invitation status"
            value={status}
            onChange={(event) => {
              setStatus((event.target as HTMLSelectElement).value as InviteStatusFilter);
              resetPage();
            }}
          >
            {INVITE_STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        columns={[
          {
            header: "Invitee",
            cell: (invite) => (
              <div>
                <div class="fw-semibold">{inviteeLabel(invite)}</div>
                {inviteeLabel(invite) !== invite.inviteeEmail && (
                  <div class="small text-muted">{invite.inviteeEmail}</div>
                )}
              </div>
            ),
            sort: { asc: "invitee_email", desc: "-invitee_email", defaultDirection: "asc" },
          },
          {
            header: "Status",
            cell: (invite) => <Badge status={invite.status} />,
            sort: { asc: "status", desc: "-status" },
          },
          {
            header: "Sent",
            cell: (invite) => fmt(invite.createdAt),
            className: "text-nowrap",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            header: "Deadline",
            cell: (invite) => (invite.expiresAt ? fmt(invite.expiresAt) : "—"),
            className: "text-nowrap",
          },
          {
            header: "Accepted",
            cell: (invite) => (invite.acceptedAt ? fmt(invite.acceptedAt) : "—"),
            className: "text-nowrap",
            sort: { asc: "accepted_at", desc: "-accepted_at", defaultDirection: "desc" },
          },
          {
            header: "",
            className: "text-end",
            cell: (invite) => {
              const busy = busyInviteId === invite.id;
              return (
                <div class="d-flex justify-content-end gap-2">
                  {invite.actions.resend && (
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-secondary"
                      disabled={busy}
                      aria-label={`Resend invitation to ${inviteeLabel(invite)}`}
                      onClick={() => void runAction(invite, "resend")}
                    >
                      Resend
                    </button>
                  )}
                  {invite.actions.revoke && (
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-danger"
                      disabled={busy}
                      aria-label={`Revoke invitation for ${inviteeLabel(invite)}`}
                      onClick={() => void runAction(invite, "revoke")}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            },
          },
        ]}
        empty="No attendee invitations for this event."
        rowKey={(invite) => invite.id}
      />
    </section>
  );
}
