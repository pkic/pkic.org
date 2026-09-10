import { useEffect, useRef, useState } from "preact/hooks";
import {
  EVENT_INVITE_STATUSES,
  eventAttendeeInvitesListResponseSchema,
  eventInviteResendResponseSchema,
  eventInvitesListResponseSchema,
  type EventInviteStatus,
  type EventInviteSummary,
} from "../../../../../shared/schemas/event-invites";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Alert } from "../../../../ui/Alert";
import { Field } from "../../../../ui/Field";
import type { MenuItem } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { TextInput } from "../../../../ui/TextControl";
import { postJson } from "../../../../shared/api-client";
import { fmt, fmtDate, toast } from "../../ui";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../shared/timezone";
import {
  BulkInviteComposer,
  eventInviteEndpoints,
  type BulkInviteType,
} from "../../../../components/event-invites/BulkInviteComposer";

const INVITE_STATUS_LABELS: Record<EventInviteStatus, string> = {
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  revoked: "Revoked",
};

/** The empty value is the filter's own "no filter", not a status an invitation can hold. */
const INVITE_STATUS_FILTERS: ReadonlyArray<{ value: "" | EventInviteStatus; label: string }> = [
  { value: "", label: "All statuses" },
  ...EVENT_INVITE_STATUSES.map((status) => ({ value: status, label: INVITE_STATUS_LABELS[status] })),
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
      let outcome: string;
      if (action === "resend") {
        await postJson(
          `${endpoint}/${encodeURIComponent(invite.id)}/resend`,
          expiresAt ? { expiresAt: dateTimeLocalToIso(expiresAt, event.timezone) } : {},
          eventInviteResendResponseSchema,
        );
        outcome = `Invitation resent to ${inviteeLabel(invite)}.`;
      } else {
        await postJson(`${endpoint}/${encodeURIComponent(invite.id)}/revoke`, {}, successResponseSchema);
        outcome = `Invitation revoked for ${inviteeLabel(invite)}.`;
      }
      /*
       * The list is reloaded before the outcome is announced, not after.
       * Announcing first said "resent" over a row that was still reloading —
       * its actions disabled by `busyInviteId` and the row itself about to be
       * replaced — so somebody acting on the message they had just been given
       * reached for a menu item that was disabled, and then gone. Reloading
       * first means the sentence and the row it describes arrive together:
       * this and the `finally` below both land in the same render.
       */
      await tableActions.current?.reload();
      setMessage(outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(`Unable to ${action} the invitation.`));
    } finally {
      setBusyInviteId(null);
    }
  }

  return (
    // Attendee and speaker invitations are two of these stacked on one tab,
    // so each is a named panel rather than a rule across the page followed by
    // a bare heading. Its body owns the rhythm; the `mb-3` the deadline field
    // carried is gone.
    <div class="pk">
      <Panel aria-label={`${label} invitations`}>
        <PanelHeader title={`${label} invitations`} headingLevel={4} />
        <PanelBody class="pk-stack">
          <BulkInviteComposer
            type={inviteType}
            event={{ endsAt: event.endsAt, timezone: event.timezone }}
            endpoints={eventInviteEndpoints(base, inviteType)}
            notify={toast}
            onSent={() => tableActions.current?.reload()}
          />
          {/* The two panels used to offer two controls both called "Resend
              deadline", which is indistinguishable to anyone moving between
              form controls. The name says which set it belongs to, and the
              sentence under it is the Field's `help` so it is announced with
              the control rather than sitting beside it. */}
          <Field
            label={`${label} resend deadline`}
            help={`Leave blank to use the event start. A custom deadline cannot be later than the event end${
              latestExpiry ? ` (${latestExpiry.replace("T", " ")} ${event.timezone})` : ""
            }.`}
          >
            {(control) => (
              <TextInput
                {...control}
                type="datetime-local"
                value={expiresAt}
                max={latestExpiry}
                onInput={(inputEvent) => setExpiresAt((inputEvent.target as HTMLInputElement).value)}
              />
            )}
          </Field>
          {/* An outcome, not decoration: the Alert carries `role="status"`
              itself, so the surface no longer hand-rolls the live region. */}
          {message && <Alert tone="ok">{message}</Alert>}
          <ErrorAlert error={error} />
          <ApiDataTable
            caption={`${label} invitations`}
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
            columns={[
              {
                header: "Invitee",
                cell: (invite) => (
                  <div class="pk-stack pk-stack--tight">
                    <span class="pk-strong">{inviteeLabel(invite)}</span>
                    {inviteeLabel(invite) !== invite.inviteeEmail && (
                      <span class="pk-small">{invite.inviteeEmail}</span>
                    )}
                  </div>
                ),
                sort: { asc: "invitee_email", desc: "-invitee_email", defaultDirection: "asc" },
              },
              {
                header: "Status",
                cell: (invite) => <Badge status={invite.status} />,
                width: "fit",
                sort: { asc: "status", desc: "-status" },
                // Two of these panels sit on one tab. The filter lives in
                // this column's menu, inside a table named after its set,
                // so the two are told apart by the list they belong to
                // rather than by two selects with two different names.
                filter: { param: "status", options: INVITE_STATUS_FILTERS },
              },
              {
                // Dates have a bounded length; the columns say so instead of
                // wearing `pk-nowrap` while still claiming slack.
                header: "Sent",
                cell: (invite) => fmtDate(invite.createdAt),
                width: "fit",
                sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
              },
              {
                header: "Deadline",
                cell: (invite) => (invite.expiresAt ? fmt(invite.expiresAt) : "—"),
                width: "fit",
              },
              {
                header: "Accepted",
                cell: (invite) => (invite.acceptedAt ? fmt(invite.acceptedAt) : "—"),
                width: "fit",
                sort: { asc: "accepted_at", desc: "-accepted_at", defaultDirection: "desc" },
              },
              {
                header: "",
                className: "pk-end",
                cell: (invite) => {
                  const busy = busyInviteId === invite.id;
                  const actions: MenuItem[] = [];
                  if (invite.actions.resend) {
                    actions.push({
                      id: "resend",
                      label: "Resend invitation",
                      onSelect: () => void runAction(invite, "resend"),
                      disabled: busy,
                    });
                  }
                  if (invite.actions.revoke) {
                    actions.push({
                      id: "revoke",
                      label: "Revoke invitation",
                      onSelect: () => void runAction(invite, "revoke"),
                      disabled: busy,
                    });
                  }
                  return <RowActions subject={inviteeLabel(invite)} actions={actions} />;
                },
              },
            ]}
            empty={`No ${inviteType} invitations for this event.`}
            rowKey={(invite) => invite.id}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
