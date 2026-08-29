import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { api, apiCommand } from "../../../api";
import { fmt } from "../../../ui";
import {
  EVENT_TEAM_ROLES,
  eventTeamRoleCreateResponseSchema,
  eventTeamRolesResponseSchema,
  type EventTeamRole,
} from "../../../../../shared/schemas/event-team";
import { performAdminAction } from "../../../actions";

const ROLE_LABELS: Record<EventTeamRole, string> = {
  organizer: "Organizer",
  program_committee: "Program Committee",
  moderator: "Moderator",
  volunteer: "Volunteer",
};

export function Team({ slug }: { slug: string }) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<EventTeamRole>("organizer");
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState("");

  async function handleRevoke(roleAssignmentId: string) {
    if (!confirm("Remove this team member?")) return;
    await performAdminAction({
      request: () =>
        apiCommand(`/api/v1/events/${encodeURIComponent(slug)}/roles/${roleAssignmentId}`, { method: "DELETE" }),
      successMessage: "Role revoked",
      afterSuccess: () => tableRef.current?.reload(),
    });
  }

  async function handleAdd(e: Event) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAddStatus("Adding…");
    await performAdminAction({
      setBusy: setAdding,
      request: () =>
        api(`/api/v1/events/${encodeURIComponent(slug)}/roles`, eventTeamRoleCreateResponseSchema, {
          method: "POST",
          body: JSON.stringify({
            userEmail: newEmail.trim(),
            role: newRole,
            expiresAt: newExpiresAt ? new Date(newExpiresAt).toISOString() : undefined,
          }),
        }),
      successMessage: "Role assigned",
      afterSuccess: async () => {
        setNewEmail("");
        setNewExpiresAt("");
        setAddStatus("");
        await tableRef.current?.reload();
      },
      onError: setAddStatus,
    });
  }

  return (
    <div>
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white fw-semibold">Add team member</div>
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

      <ApiDataTable
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/roles`}
        responseSchema={eventTeamRolesResponseSchema}
        resolve={(data) => data.roles}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="Search email or role…"
        actionsRef={tableRef}
        columns={[
          { header: "Email", cell: (role) => role.userEmail, sort: { asc: "userEmail", desc: "-userEmail" } },
          {
            header: "Role",
            cell: (assignment) => <span class="badge text-bg-secondary">{ROLE_LABELS[assignment.role]}</span>,
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
              <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(role.id)}>
                Revoke
              </button>
            ),
          },
        ]}
        empty="No team members"
        rowKey={(role) => role.id}
      />
    </div>
  );
}
