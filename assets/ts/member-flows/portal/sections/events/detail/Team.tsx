import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../../components/EmptyState";
import { PersonCell, personDisplayName } from "../../../../../components/PersonCell";
import { UserPicker, type PickedUser } from "../../../../../components/UserPicker";
import { RowActions } from "../../../../../ui/RowActions";
import { Badge as StatusBadge } from "../../../../../components/Badge";
import { Alert } from "../../../../../ui/Alert";
import { Badge } from "../../../../../ui/Badge";
import { Button, ButtonLink } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../ui/TextControl";
import { usePortalHashLocation } from "../../../hash-location";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { deleteJson, postJson } from "../../../../../shared/api-client";
import { fmt } from "../../../ui";
import {
  EVENT_TEAM_ROLES,
  eventTeamRoleCreateResponseSchema,
  eventTeamRoleCreateSchema,
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

/** Reserved team segment that routes to the add page instead of the list. */
const NEW_TEAM_MEMBER_SEGMENT = "new";

/**
 * Adding a team member: a page of its own under the roster, never a form
 * unfolding above it. The person is found with the user picker — a team
 * member is an existing user, linked, not an address that becomes an account
 * (#88) — and the way back is the roster's own address.
 */
function AddTeamMemberPage({ slug, teamPath }: { slug: string; teamPath: string }) {
  const [, navigate] = usePortalHashLocation();
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [role, setRole] = useState<EventTeamRole>("organizer");
  const [expiresAt, setExpiresAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  // One basis for validation: the assignment contract the route parses checks
  // the draft as it is built and is the only thing that may refuse it.
  const form = useContractForm(eventTeamRoleCreateSchema, {
    userId: picked?.id ?? "",
    role,
    ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
  });

  async function handleAdd(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    await performAction({
      setBusy: setAdding,
      request: () =>
        postJson(`/api/v1/events/${encodeURIComponent(slug)}/roles`, checked.data, eventTeamRoleCreateResponseSchema),
      successMessage: "Team member added",
      // Back to the roster, which fetches on its own when it mounts.
      afterSuccess: () => navigate(teamPath),
      onError: setError,
    });
  }

  return (
    <Panel aria-label="Add team member">
      <PanelHeader title="Add team member" breadcrumb />
      <PanelBody>
        <form
          class="pk-stack"
          aria-label="Add team member"
          noValidate
          {...form.handlers}
          onSubmit={(event) => void handleAdd(event)}
        >
          {/* One `disabled` on the group rather than one per control: the
              picker is a child component that takes no disabled prop of its
              own. */}
          <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={adding}>
            <Field
              label="Person"
              required
              help="Search by name or email for someone the portal knows."
              {...form.of("userId")}
            >
              {(control) => <UserPicker value={picked} onChange={setPicked} inputProps={control} />}
            </Field>
            <Field label="Role" {...form.of("role")}>
              {(control) => (
                <Select
                  {...control}
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.currentTarget.value as EventTeamRole)}
                >
                  {EVENT_TEAM_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Expires" help="Leave empty for an assignment that never expires." {...form.of("expiresAt")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="expiresAt"
                  type="datetime-local"
                  value={expiresAt}
                  onInput={(e) => setExpiresAt(e.currentTarget.value)}
                />
              )}
            </Field>
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={adding} disabled={adding}>
              {adding ? "Adding…" : "Add team member"}
            </Button>
            <ButtonLink href={usePortalHashLocation.hrefs(teamPath)} variant="ghost">
              Cancel
            </ButtonLink>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}

export function Team({
  slug,
  teamSegment,
  teamPath = `/events/${encodeURIComponent(slug)}/settings/team`,
}: {
  slug: string;
  teamSegment?: string;
  /** Where the list lives, so the add page below it stays inside the workspace that rendered it. */
  teamPath?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const tableRef = useRef<ApiTableActions | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleRevoke(assignment: EventTeamRoleAssignment) {
    const roleLabel = ROLE_LABELS[assignment.role];
    const person = personDisplayName(assignment.userFirstName, assignment.userLastName, assignment.userEmail);
    if (
      !(await confirmAction({
        title: `Revoke the ${roleLabel} role from ${person}?`,
        consequences: [`${person} loses ${roleLabel.toLowerCase()} access to this event`],
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

  if (teamSegment === NEW_TEAM_MEMBER_SEGMENT) {
    return <AddTeamMemberPage slug={slug} teamPath={teamPath} />;
  }

  return (
    <div class="pk pk-stack">
      <ApiDataTable
        caption="Event team members"
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/roles`}
        responseSchema={eventTeamRolesResponseSchema}
        resolve={(data) => data.roles}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="Search email or role…"
        createAction={{
          label: "Add team member",
          onSelect: () => navigate(`${teamPath}/${NEW_TEAM_MEMBER_SEGMENT}`),
        }}
        actionsRef={tableRef}
        columns={[
          {
            // A person, not an address (#88, #90): the same face-then-name
            // cell every roster uses, and the row opens their record.
            header: "Person",
            cell: (role) => (
              <PersonCell
                firstName={role.userFirstName}
                lastName={role.userLastName}
                email={role.userEmail}
                headshotUrl={role.headshotUrl}
              />
            ),
            width: "primary",
            sort: { asc: "userEmail", desc: "-userEmail" },
          },
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
                subject={personDisplayName(role.userFirstName, role.userLastName, role.userEmail)}
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
        rowAction={(role) => ({
          label: `Open ${personDisplayName(role.userFirstName, role.userLastName, role.userEmail)}`,
          href: usePortalHashLocation.hrefs(`/users/${encodeURIComponent(role.userId)}`),
        })}
      />
    </div>
  );
}
