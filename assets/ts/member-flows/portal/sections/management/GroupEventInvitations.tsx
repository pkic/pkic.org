import { useEffect, useRef, useState } from "preact/hooks";
import {
  eventAttendeeInvitesListResponseSchema,
  eventInviteResendResponseSchema,
  eventInvitesListResponseSchema,
  type EventInviteSummary,
} from "../../../../../shared/schemas/event-invites";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import type { MenuAction } from "../../../../components/Menu";
import { RowActions } from "../../../../components/RowActions";
import { postJson } from "../../../../shared/api-client";
import { fmt, fmtDate, toast } from "../../ui";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../shared/timezone";
import {
  BulkInviteComposer,
  eventInviteEndpoints,
  type BulkInviteType,
} from "../../../../components/event-invites/BulkInviteComposer";

type InviteStatusFilter = "" | EventInviteSummary["status"];

const INVITE_STATUS_FILTERS: ReadonlyArray<{ value: InviteStatusFilter; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

type InvitationRow = Pick<
  EventInviteSummary,
  "id" | "inviteeEmail" | "inviteeFirstName" | "inviteeLastName" | "status" | "actions"
>;

function inviteeLabel(invite: InvitationRow): string {
  const name = [invite.inviteeFirstName, invite.inviteeLastName].filter(Boolean).join(" ");
  return name || invite.inviteeEmail;
}

/**
 * Selected-group attendee invitation lifecycle. The server remains the source
 * of truth for whether a specific invitation may be resent or revoked.
 */
export function GroupEventInvitations({
  groupId,
  event,
  inviteType = "attendee",
}: {
  groupId: string;
  event: GroupEvent;
  inviteType?: BulkInviteType;
}) {
  const tableActions = useRef<ApiTableActions | null>(null);
  const [status, setStatus] = useState<InviteStatusFilter>("");
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/invites`;
  const endpoint = inviteType === "attendee" ? base : `${base}/speakers`;
  const label = inviteType === "attendee" ? "Attendee" : "Speaker";
  const latestExpiry = event.endsAt ? instantToDateTimeLocal(event.endsAt, event.timezone) : undefined;

  useEffect(() => {
    setExpiresAt("");
  }, [event.id]);

  async function runAction(invite: InvitationRow, action: "resend" | "revoke"): Promise<void> {
    if (action === "revoke") {
      const confirmed = await confirmAction({
        title: `Revoke the invitation for ${inviteeLabel(invite)}?`,
        body: "They will no longer be able to accept this invitation.",
        consequences: [
          "The invitation link stops working immediately",
          "You can send a new invitation later if you change your mind",
        ],
        confirmLabel: "Revoke invitation",
      });
      if (!confirmed) return;
    }

    setBusyInviteId(invite.id);
    setError(null);
    setMessage(null);
    try {
      if (action === "resend") {
        await postJson(
          `${endpoint}/${encodeURIComponent(invite.id)}/resend`,
          expiresAt ? { expiresAt: dateTimeLocalToIso(expiresAt, event.timezone) } : {},
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
    <section class="border-top pt-3" aria-label={`${label} invitations`}>
      <h6 class="small fw-semibold">{label} invitations</h6>
      <BulkInviteComposer
        type={inviteType}
        event={{ endsAt: event.endsAt, timezone: event.timezone }}
        endpoints={eventInviteEndpoints(base, inviteType)}
        notify={toast}
        onSent={() => tableActions.current?.reload()}
      />
      <div class="mb-3">
        <label class="form-label small fw-semibold" for={`group-event-invite-deadline-${event.id}-${inviteType}`}>
          Resend deadline
        </label>
        <input
          id={`group-event-invite-deadline-${event.id}-${inviteType}`}
          class="form-control form-control-sm"
          type="datetime-local"
          value={expiresAt}
          max={latestExpiry}
          onInput={(inputEvent) => setExpiresAt((inputEvent.target as HTMLInputElement).value)}
        />
        <div class="form-text">
          Leave blank to use the event start. A custom deadline cannot be later than the event end
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
        responseSchema={
          inviteType === "attendee" ? eventAttendeeInvitesListResponseSchema : eventInvitesListResponseSchema
        }
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
            cell: (invite) => fmtDate(invite.createdAt),
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
              const actions: MenuAction[] = [];
              if (invite.actions.resend) {
                actions.push({
                  key: "resend",
                  label: "Resend invitation",
                  onSelect: () => void runAction(invite, "resend"),
                  disabled: busy,
                });
              }
              if (invite.actions.revoke) {
                actions.push({
                  key: "revoke",
                  label: "Revoke invitation",
                  onSelect: () => void runAction(invite, "revoke"),
                  disabled: busy,
                });
              }
              return <RowActions label={`Actions for ${inviteeLabel(invite)}`} actions={actions} />;
            },
          },
        ]}
        empty={`No ${inviteType} invitations for this event.`}
        rowKey={(invite) => invite.id}
      />
    </section>
  );
}
