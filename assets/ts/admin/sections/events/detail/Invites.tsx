import { useState, useRef } from "preact/hooks";
import { BulkInviteComposer, eventInviteEndpoints } from "../../../../components/event-invites/BulkInviteComposer";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { Tabs } from "../../../../components/Tabs";
import { api, apiCommand } from "../../../api";
import { fmt, toast } from "../../../ui";
import {
  eventInviteResendResponseSchema,
  eventInvitesListResponseSchema,
} from "../../../../../shared/schemas/event-invites";
import type { EventDetail } from "../../../types";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../shared/timezone";

export type InviteType = "attendee" | "speaker";

function SpeakerInviteList({ slug, event }: { slug: string; event: EventDetail }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const tableRef = useRef<ApiTableActions | null>(null);
  // The transitional admin endpoint is speaker-only; attendee lifecycle moved
  // to selected-group management.
  const endpoint = `/api/v1/admin/events/${encodeURIComponent(slug)}/invites`;

  async function handleResend(inviteId: string): Promise<void> {
    try {
      await api(`${endpoint}/${encodeURIComponent(inviteId)}/resend`, eventInviteResendResponseSchema, {
        method: "POST",
        body: JSON.stringify(expiresAt ? { expiresAt: dateTimeLocalToIso(expiresAt, event.timezone) } : {}),
      });
      toast("Speaker invitation resent", "success");
      await tableRef.current?.reload();
    } catch (cause) {
      toast((cause as Error).message, "error");
    }
  }

  async function handleRevoke(inviteId: string): Promise<void> {
    if (!confirm("Revoke this speaker invitation?")) return;
    try {
      await apiCommand(`${endpoint}/${encodeURIComponent(inviteId)}/revoke`, { method: "POST", body: "{}" });
      toast("Speaker invitation revoked", "success");
      await tableRef.current?.reload();
    } catch (cause) {
      toast((cause as Error).message, "error");
    }
  }

  return (
    <ApiDataTable
      endpoint={endpoint}
      responseSchema={eventInvitesListResponseSchema}
      resolve={(response) => response.invites}
      resolvePage={(response) => response.page}
      paginate
      searchPlaceholder="Search speaker invitations…"
      params={statusFilter ? { status: statusFilter } : undefined}
      actionsRef={tableRef}
      toolbar={({ resetPage }) => (
        <div class="d-flex gap-2 flex-wrap align-items-center">
          <select
            class="form-select form-select-sm adm-filter-select"
            aria-label="Speaker invitation status"
            value={statusFilter}
            onChange={(filterEvent) => {
              setStatusFilter((filterEvent.target as HTMLSelectElement).value);
              resetPage();
            }}
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <label class="small fw-semibold mb-0" for="speaker-resend-deadline">
            Resend deadline
          </label>
          <input
            id="speaker-resend-deadline"
            class="form-control form-control-sm w-auto"
            type="datetime-local"
            value={expiresAt}
            max={event.ends_at ? instantToDateTimeLocal(event.ends_at, event.timezone) : undefined}
            onInput={(inputEvent) => setExpiresAt((inputEvent.target as HTMLInputElement).value)}
          />
        </div>
      )}
      columns={[
        {
          header: "Invitee",
          cell: (invite) => (
            <div>
              <div class="fw-semibold">
                {[invite.inviteeFirstName, invite.inviteeLastName].filter(Boolean).join(" ") || "—"}
              </div>
              <div class="small text-muted">{invite.inviteeEmail}</div>
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
          className: "mono small",
          sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
        },
        {
          header: "Accepted",
          cell: (invite) => (invite.acceptedAt ? fmt(invite.acceptedAt) : "—"),
          className: "mono small",
          sort: { asc: "accepted_at", desc: "-accepted_at", defaultDirection: "desc" },
        },
        {
          header: "",
          className: "text-end",
          cell: (invite) => (
            <div class="d-flex justify-content-end gap-2">
              {invite.actions.resend && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  onClick={() => void handleResend(invite.id)}
                >
                  Resend
                </button>
              )}
              {invite.actions.revoke && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  onClick={() => void handleRevoke(invite.id)}
                >
                  Revoke
                </button>
              )}
            </div>
          ),
        },
      ]}
      empty="No speaker invitations found."
      rowKey={(invite) => invite.id}
    />
  );
}

export function Invites({
  slug,
  event,
  inviteType = "attendee",
}: {
  slug: string;
  event: EventDetail;
  inviteType?: InviteType;
}) {
  const [tab, setTab] = useState<"send" | "list">("send");
  const composer = (
    <BulkInviteComposer
      type={inviteType}
      event={{ endsAt: event.ends_at, timezone: event.timezone }}
      endpoints={eventInviteEndpoints(`/api/v1/admin/events/${encodeURIComponent(slug)}/invites`, inviteType)}
      notify={toast}
    />
  );
  if (inviteType === "attendee") {
    return (
      <>
        <h6 class="mb-3">Send Attendee Invites</h6>
        {composer}
      </>
    );
  }

  return (
    <div>
      <Tabs
        items={[
          { key: "send", label: "Send Speaker Invites" },
          { key: "list", label: "Speaker Invite List" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "send" | "list")}
      />
      {tab === "send" && composer}
      {tab === "list" && <SpeakerInviteList slug={slug} event={event} />}
    </div>
  );
}
