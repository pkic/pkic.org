/**
 * The invitations one event has sent to one audience — attendees or speakers.
 *
 * One list panel, the way every collection is drawn: search, the status
 * filter in its column, the rows, and "Invite …" in the head. Composing a
 * batch is a page of its own under the list, with its own address, rather
 * than a form standing open above the rows every time the tab is opened.
 * Resending asks for its deadline in a dialog, because the deadline belongs
 * to that one resend — the page used to carry a "resend deadline" field that
 * silently applied to whichever row was resent next.
 */
import { useRef, useState } from "preact/hooks";
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
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Alert } from "../../../../ui/Alert";
import { Dialog } from "../../../../ui/Dialog";
import { Field } from "../../../../ui/Field";
import type { MenuItem } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { TextInput } from "../../../../ui/TextControl";
import { postJson } from "../../../../shared/api-client";
import { usePortalHashLocation } from "../../hash-location";
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

/** Reserved segment under the list that opens the composer page. */
export const NEW_INVITATIONS_SEGMENT = "new";

type InvitationRow = Pick<
  EventInviteSummary,
  "id" | "inviteeEmail" | "inviteeFirstName" | "inviteeLastName" | "status" | "actions"
>;

function inviteeLabel(invite: InvitationRow): string {
  const name = [invite.inviteeFirstName, invite.inviteeLastName].filter(Boolean).join(" ");
  return name || invite.inviteeEmail;
}

/**
 * Selected-group invitation lifecycle for one audience. The server remains
 * the source of truth for whether a specific invitation may be resent or
 * revoked.
 */
export function GroupEventInvitations({
  groupId,
  event,
  inviteType = "attendee",
  segment,
  listPath,
}: {
  groupId: string;
  event: GroupEvent;
  inviteType?: BulkInviteType;
  /** The segment below the list: `"new"` opens the composer page. */
  segment?: string;
  /** Where this audience's list lives, so the composer page and its way back are addresses. */
  listPath: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const tableActions = useRef<ApiTableActions | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resending, setResending] = useState<InvitationRow | null>(null);
  const [resendDeadline, setResendDeadline] = useState("");
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/invites`;
  const endpoint = inviteType === "attendee" ? base : `${base}/speakers`;
  const label = inviteType === "attendee" ? "Attendee" : "Speaker";
  const audience = inviteType === "attendee" ? "attendees" : "speakers";
  const latestExpiry = event.endsAt ? instantToDateTimeLocal(event.endsAt, event.timezone) : undefined;

  async function revoke(invite: InvitationRow): Promise<void> {
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
    await run(invite, async () => {
      await postJson(`${endpoint}/${encodeURIComponent(invite.id)}/revoke`, {}, successResponseSchema);
      return `Invitation revoked for ${inviteeLabel(invite)}.`;
    });
  }

  async function resend(invite: InvitationRow, deadline: string): Promise<void> {
    await run(invite, async () => {
      await postJson(
        `${endpoint}/${encodeURIComponent(invite.id)}/resend`,
        deadline ? { expiresAt: dateTimeLocalToIso(deadline, event.timezone) } : {},
        eventInviteResendResponseSchema,
      );
      return `Invitation resent to ${inviteeLabel(invite)}.`;
    });
  }

  async function run(invite: InvitationRow, action: () => Promise<string>): Promise<void> {
    setBusyInviteId(invite.id);
    setError(null);
    setMessage(null);
    try {
      const outcome = await action();
      /*
       * The list is reloaded before the outcome is announced, not after.
       * Announcing first said "resent" over a row that was still reloading —
       * its actions disabled and the row itself about to be replaced — so
       * somebody acting on the message reached for a menu item that was
       * disabled, and then gone.
       */
      await tableActions.current?.reload();
      setMessage(outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Unable to update the invitation."));
    } finally {
      setBusyInviteId(null);
    }
  }

  if (segment === NEW_INVITATIONS_SEGMENT) {
    return (
      // Composing is a page of its own: a heading that names what is being
      // sent, its place in the trail, and no list competing for the screen.
      <div class="pk pk-stack">
        <Panel aria-label={`Invite ${audience}`}>
          <PanelHeader title={`Invite ${audience}`} breadcrumb />
          <PanelBody>
            <BulkInviteComposer
              type={inviteType}
              event={{ endsAt: event.endsAt, timezone: event.timezone }}
              endpoints={eventInviteEndpoints(base, inviteType)}
              notify={toast}
              onSent={() => navigate(listPath)}
            />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  return (
    <div class="pk pk-stack pk-stack--snug">
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
        searchPlaceholder="name or email"
        initialSort="-created_at"
        createAction={{
          label: `Invite ${audience}`,
          onSelect: () => navigate(`${listPath}/${NEW_INVITATIONS_SEGMENT}`),
        }}
        columns={[
          {
            header: "Invitee",
            cell: (invite) => (
              <div class="pk-stack pk-stack--tight">
                <span class="pk-strong">{inviteeLabel(invite)}</span>
                {inviteeLabel(invite) !== invite.inviteeEmail && (
                  <span class="pk-small pk-muted">{invite.inviteeEmail}</span>
                )}
              </div>
            ),
            width: "primary",
            sort: { asc: "invitee_email", desc: "-invitee_email", defaultDirection: "asc" },
          },
          {
            header: "Status",
            cell: (invite) => <Badge status={invite.status} />,
            width: "fit",
            sort: { asc: "status", desc: "-status" },
            filter: { param: "status", options: INVITE_STATUS_FILTERS },
          },
          {
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
                  onSelect: () => {
                    setResendDeadline("");
                    setResending(invite);
                  },
                  disabled: busy,
                });
              }
              if (invite.actions.revoke) {
                actions.push({
                  id: "revoke",
                  label: "Revoke invitation",
                  onSelect: () => void revoke(invite),
                  disabled: busy,
                });
              }
              return <RowActions subject={inviteeLabel(invite)} actions={actions} />;
            },
          },
        ]}
        empty={
          <EmptyState
            title={`No ${inviteType} invitations yet`}
            body={`Use Invite ${audience} above to send the first batch.`}
          />
        }
        rowKey={(invite) => invite.id}
      />
      {/* Mounted only while a resend is pending: the dialog's sheet is drawn
          by its class, not by the platform's open state, so a closed dialog
          left in the tree would still sit on the page. */}
      {resending && (
        <Dialog
          open
          title={`Resend the invitation to ${inviteeLabel(resending)}?`}
          description="A fresh invitation email goes out with a new link."
          confirmLabel="Resend invitation"
          onCancel={() => setResending(null)}
          onConfirm={() => {
            const invite = resending;
            setResending(null);
            if (invite) void resend(invite, resendDeadline);
          }}
        >
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
                value={resendDeadline}
                max={latestExpiry}
                onInput={(inputEvent) => setResendDeadline((inputEvent.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        </Dialog>
      )}
    </div>
  );
}
