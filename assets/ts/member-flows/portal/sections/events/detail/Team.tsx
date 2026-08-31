import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../../components/EmptyState";
import { RowActions } from "../../../../../ui/RowActions";
import { Badge } from "../../../../../components/Badge";
import { deleteJson, postJson } from "../../../../../shared/api-client";
import { fmt } from "../../../ui";
import {
  EVENT_TEAM_ROLES,
  eventTeamRoleCreateResponseSchema,
  eventTeamRolesResponseSchema,
  type EventTeamRole,
  type EventTeamRoleAssignment,
} from "../../../../../../shared/schemas/event-team";
import { successResponseSchema } from "../../../../../../shared/schemas/api-common";
import { performAction } from "../../../actions";

const ROLE_LABELS: Record<EventTeamRole, string> = {
  organizer: "Organizer",
  program_committee: "Program Committee",
  moderator: "Moderator",
  volunteer: "Volunteer",
};

export function Team({ slug }: { slug: string }) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<EventTeamRole>("organizer");
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleRevoke(assignment: EventTeamRoleAssignment) {
    const roleLabel = ROLE_LABELS[assignment.role];
    if (
      !(await confirmAction({
        title: `Revoke the ${roleLabel} role from ${assignment.userEmail}?`,
        consequences: [`${assignment.userEmail} loses ${roleLabel.toLowerCase()} access to this event`],
        confirmLabel: "Revoke role",
      }))
    )
      return;
    await performAction({
      setBusy: (busy) => setRevokingId(busy ? assignment.id : null),
      request: () =>
        deleteJson(`/api/v1/events/${encodeURIComponent(slug)}/roles/${assignment.id}`, successResponseSchema),
      successMessage: "Role revoked",
      afterSuccess: () => tableRef.current?.reload(),
    });
  }

  async function handleAdd(e: Event) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAddStatus("Adding…");
    await performAction({
      setBusy: setAdding,
      request: () =>
        postJson(
          `/api/v1/events/${encodeURIComponent(slug)}/roles`,
          {
            userEmail: newEmail.trim(),
            role: newRole,
            expiresAt: newExpiresAt ? new Date(newExpiresAt).toISOString() : undefined,
          },
          eventTeamRoleCreateResponseSchema,
        ),
      successMessage: "Role assigned",
      afterSuccess: async () => {
        setNewEmail("");
        setNewExpiresAt("");
        setAddStatus("");
        setShowAddForm(false);
        await tableRef.current?.reload();
      },
      onError: setAddStatus,
    });
  }

  return (
    <div>
      {showAddForm && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white d-flex align-items-center justify-content-between">
            <span class="fw-semibold">Add team member</span>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              onClick={() => {
                setShowAddForm(false);
                setAddStatus("");
              }}
            >
              Cancel
            </button>
          </div>
          <div class="card-body">
            <form onSubmit={handleAdd} class="d-flex gap-2 align-items-end flex-wrap">
              <div>
                <label class="form-label small fw-semibold" for="event-team-email">
                  Email
                </label>
                <input
                  id="event-team-email"
                  class="form-control form-control-sm"
                  type="email"
                  value={newEmail}
                  onInput={(e) => setNewEmail((e.target as HTMLInputElement).value)}
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div>
                <label class="form-label small fw-semibold" for="event-team-role">
                  Role
                </label>
                <select
                  id="event-team-role"
                  class="form-select form-select-sm"
                  value={newRole}
                  onChange={(e) => setNewRole((e.target as HTMLSelectElement).value as EventTeamRole)}
                >
                  {EVENT_TEAM_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label class="form-label small fw-semibold" for="event-team-expires-at">
                  Expires (optional)
                </label>
                <input
                  id="event-team-expires-at"
                  class="form-control form-control-sm"
                  type="datetime-local"
                  value={newExpiresAt}
                  onInput={(e) => setNewExpiresAt((e.target as HTMLInputElement).value)}
                />
              </div>
              <button type="submit" class="btn btn-sm btn-success" disabled={adding}>
                Add
              </button>
              {addStatus && <span class="small text-danger">{addStatus}</span>}
            </form>
          </div>
        </div>
      )}

      <ApiDataTable
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/roles`}
        responseSchema={eventTeamRolesResponseSchema}
        resolve={(data) => data.roles}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="Search email or role…"
        createAction={{ label: "Add team member", onSelect: () => setShowAddForm(true) }}
        actionsRef={tableRef}
        columns={[
          { header: "Email", cell: (role) => role.userEmail, sort: { asc: "userEmail", desc: "-userEmail" } },
          {
            header: "Role",
            cell: (assignment) => <Badge status={assignment.role} label={ROLE_LABELS[assignment.role]} />,
            sort: { asc: "role", desc: "-role" },
          },
          { header: "Added by", cell: (role) => role.granterEmail ?? "—", className: "small text-muted" },
          {
            header: "Added",
            cell: (role) => role.createdAt.substring(0, 10),
            className: "mono small",
            sort: { asc: "createdAt", desc: "-createdAt", defaultDirection: "desc" },
          },
          {
            header: "Expires",
            cell: (role) =>
              role.expiresAt ? (
                <span class={new Date(role.expiresAt).getTime() < Date.now() ? "text-danger" : ""}>
                  {fmt(role.expiresAt)}
                </span>
              ) : (
                <span class="text-muted">Never</span>
              ),
            className: "small",
            sort: { asc: "expiresAt", desc: "-expiresAt" },
          },
          {
            header: "",
            cell: (role) => (
              <RowActions
                label={`Actions for ${role.userEmail}`}
                actions={[
                  {
                    id: "revoke",
                    label: revokingId === role.id ? "Revoking…" : "Revoke",
                    onSelect: () => void handleRevoke(role),
                    disabled: revokingId !== null,
                  },
                ]}
              />
            ),
          },
        ]}
        empty={<EmptyState title="No team members yet" body="Add a team member to get started." />}
        rowKey={(role) => role.id}
      />
    </div>
  );
}
