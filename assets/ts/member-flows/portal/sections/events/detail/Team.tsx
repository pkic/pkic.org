import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../../components/EmptyState";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { RowActions } from "../../../../../ui/RowActions";
import { Badge as StatusBadge } from "../../../../../components/Badge";
import { Badge } from "../../../../../ui/Badge";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../ui/TextControl";
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
// The "Added" column asks for `pk-mono`, which lives in Content.css rather than
// the entry stylesheet, so this surface has to pull that chunk in itself.
import "../../../../../ui/Content.css";

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
  const [addError, setAddError] = useState("");
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
    setAddError("");
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
        setAddError("");
        setShowAddForm(false);
        await tableRef.current?.reload();
      },
      onError: setAddError,
    });
  }

  return (
    <div class="pk pk-stack">
      {showAddForm && (
        <Panel>
          <PanelHeader title="Add team member" headingLevel={4}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowAddForm(false);
                setAddError("");
              }}
            >
              Cancel
            </Button>
          </PanelHeader>
          <PanelBody>
            <form class="pk-stack" aria-label="Add team member" onSubmit={(e) => void handleAdd(e)}>
              {/* One `disabled` on the group rather than one per control: the
                  controls are rendered by a child component that takes no
                  disabled prop of its own. */}
              <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={adding}>
                <Field label="Email" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="email"
                      value={newEmail}
                      placeholder="user@example.com"
                      onInput={(e) => setNewEmail(e.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field label="Role">
                  {(control) => (
                    <Select
                      {...control}
                      value={newRole}
                      onChange={(e) => setNewRole(e.currentTarget.value as EventTeamRole)}
                    >
                      {EVENT_TEAM_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Expires" help="Leave empty for an assignment that never expires.">
                  {(control) => (
                    <TextInput
                      {...control}
                      type="datetime-local"
                      value={newExpiresAt}
                      onInput={(e) => setNewExpiresAt(e.currentTarget.value)}
                    />
                  )}
                </Field>
              </fieldset>
              {addError && <ErrorAlert error={addError} />}
              <div class="pk-cluster">
                <Button type="submit" variant="primary" size="sm" loading={adding}>
                  {adding ? "Adding…" : "Add"}
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      )}

      <ApiDataTable
        caption="Event team members"
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
            cell: (assignment) => <StatusBadge status={assignment.role} label={ROLE_LABELS[assignment.role]} />,
            sort: { asc: "role", desc: "-role" },
          },
          { header: "Added by", cell: (role) => role.granterEmail ?? "—", className: "pk-small pk-muted" },
          {
            header: "Added",
            cell: (role) => role.createdAt.substring(0, 10),
            className: "pk-mono pk-small pk-nowrap",
            sort: { asc: "createdAt", desc: "-createdAt", defaultDirection: "desc" },
          },
          {
            header: "Expires",
            // An assignment that has run out says so in a word. The cell this
            // replaces turned the date red and left the reader to infer the
            // rest, which is the one signal a colour cannot carry alone.
            cell: (role) =>
              role.expiresAt ? (
                <span class="pk-cluster">
                  <span>{fmt(role.expiresAt)}</span>
                  {new Date(role.expiresAt).getTime() < Date.now() && <Badge tone="danger">Expired</Badge>}
                </span>
              ) : (
                <span class="pk-muted">Never</span>
              ),
            className: "pk-small",
            sort: { asc: "expiresAt", desc: "-expiresAt" },
          },
          {
            header: "",
            className: "pk-end",
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
