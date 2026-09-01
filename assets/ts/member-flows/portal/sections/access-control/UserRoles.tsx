import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { TextInput } from "../../../../ui/TextControl";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  userRoleResponseEnvelopeSchema,
  userRolesListResponseSchema,
  type UserRoleAssignment,
} from "../../../../../shared/schemas/access-control";
import { fmt, fmtDate, toast } from "../../ui";
import { TargetPicker, type PickedTarget } from "./TargetPicker";
import { roleCatalog } from "./catalogs";
// A role name, a context reference, and a grant date are identifiers, so their
// columns are set in `pk-mono`. That class lives in the content stylesheet and
// component CSS ships in lazy chunks, so the module that names the class
// imports the sheet rather than relying on the table having pulled it in.
import "../../../../ui/Content.css";

/** People with assigned roles: permissioned users (often community members, not staff). */
export function UserRoles({ canGrant = true, canRevoke = true }: { canGrant?: boolean; canRevoke?: boolean } = {}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const tableRef = useRef<ApiTableActions | null>(null);
  const [roleId, setRoleId] = useState("");
  const [roleLabel, setRoleLabel] = useState<string>();
  const [target, setTarget] = useState<PickedTarget>({ targetType: null, targetId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /*
   * What went wrong stays beside the form rather than in a toast that has
   * already faded by the time the reader reaches the control it is about.
   * `Alert`'s danger tone carries role="alert", so it is announced as it
   * appears without moving focus out of the form.
   */
  const [formError, setFormError] = useState<string | null>(null);

  async function handleAssign(e: Event) {
    e.preventDefault();
    setFormError(null);
    if (!user || !roleId) {
      setFormError("Pick a user and a role first.");
      return;
    }
    if (target.targetType && !target.targetId) {
      setFormError("Pick a specific event or working group, or clear the context.");
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        `/api/v1/users/${user.id}/roles`,
        {
          roleId,
          contextType: target.targetType,
          contextId: target.targetId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
        userRoleResponseEnvelopeSchema,
      );
      toast("Role assigned", "success");
      setTarget({ targetType: null, targetId: null });
      setExpiresAt("");
      await tableRef.current?.reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(assignment: UserRoleAssignment) {
    if (!user) return;
    const confirmed = await confirmAction({
      title: `Revoke the "${assignment.roleName}" role from ${user.email}?`,
      consequences: [`${user.email} loses the permissions this role grants`],
      confirmLabel: "Revoke role",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`/api/v1/users/${user.id}/roles/${assignment.id}`, successResponseSchema);
      toast("Role revoked", "success");
      await tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="People — assign roles" />
        <PanelBody class="pk-stack">
          {/* The people search is several controls, so it is named by a legend
              rather than by a label with no single control to point its `for`
              at. The width constraint stays on the group, as it was. */}
          <fieldset class="pk-fieldset pk-field portal-access-role-user-picker">
            <legend class="pk-field__label">User</legend>
            <UserPicker endpoint="/api/v1/permissions/subjects" value={user} onChange={setUser} />
          </fieldset>

          {!user ? (
            <p class="pk-muted pk-small">Pick a user to view and manage their role assignments.</p>
          ) : (
            <>
              {canGrant && (
                <form
                  class="pk-stack"
                  aria-label={`Assign a role to ${user.email}`}
                  onSubmit={(e) => void handleAssign(e)}
                >
                  {/* One `disabled` takes the whole form out of play while the
                      request is in flight, including the pickers this surface
                      cannot reach a prop into. */}
                  <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={submitting}>
                    <ServerSearchSelect
                      catalog={roleCatalog}
                      label="Role"
                      value={roleId}
                      selectedLabel={roleLabel}
                      disabled={submitting}
                      allowEmpty={false}
                      autoSelectFirst
                      onChange={(role) => {
                        setRoleId(role?.id ?? "");
                        setRoleLabel(role?.name);
                      }}
                    />
                    <fieldset class="pk-fieldset pk-field">
                      <legend class="pk-field__label">Target</legend>
                      <TargetPicker value={target} onChange={setTarget} disabled={submitting} />
                    </fieldset>
                    <Field label="Expires (optional)" help="Leave empty for an assignment that never expires.">
                      {(control) => (
                        <TextInput
                          {...control}
                          type="datetime-local"
                          value={expiresAt}
                          onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
                          disabled={submitting}
                        />
                      )}
                    </Field>
                  </fieldset>

                  {formError && <Alert tone="danger">{formError}</Alert>}

                  <div class="pk-cluster">
                    <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!roleId}>
                      {submitting ? "Assigning…" : "Assign"}
                    </Button>
                  </div>
                </form>
              )}

              <ApiDataTable
                caption={`Roles assigned to ${user.email}`}
                endpoint={`/api/v1/users/${user.id}/roles`}
                responseSchema={userRolesListResponseSchema}
                resolve={(response) => response.roles}
                resolvePage={(response) => response.page}
                paginate
                initialPageSize={25}
                initialSort="-created_at"
                searchPlaceholder="Search role assignments…"
                actionsRef={tableRef}
                rowKey={(assignment) => assignment.id}
                empty="No roles assigned"
                columns={[
                  {
                    header: "Role",
                    // The weight is on the cell's own element: a column's
                    // `className` is translated through a closed vocabulary
                    // that has no entry for it, so it would be dropped.
                    cell: (assignment) => <span class="pk-strong">{assignment.roleName}</span>,
                    className: "pk-mono",
                    sort: { asc: "role_name", desc: "-role_name" },
                  },
                  {
                    header: "Context",
                    cell: (assignment) =>
                      assignment.contextType ? (
                        `${assignment.contextType}:${assignment.contextId}`
                      ) : (
                        <span class="pk-muted">Global</span>
                      ),
                    className: "pk-small pk-mono",
                    sort: { asc: "context_type", desc: "-context_type" },
                  },
                  {
                    // Dates have a bounded length; the columns say so and
                    // keep the table's own ink and size.
                    header: "Expires",
                    cell: (assignment) =>
                      assignment.expiresAt ? fmt(assignment.expiresAt) : <span class="pk-muted">Never</span>,
                    width: "fit",
                    sort: { asc: "expires_at", desc: "-expires_at" },
                  },
                  {
                    header: "Granted",
                    cell: (assignment) => fmtDate(assignment.createdAt),
                    width: "fit",
                    sort: { asc: "created_at", desc: "-created_at" },
                  },
                  {
                    header: "",
                    cell: (assignment) =>
                      canRevoke ? (
                        <RowActions
                          subject={assignment.roleName}
                          actions={[
                            { id: "revoke", label: "Revoke role", onSelect: () => void handleRevoke(assignment) },
                          ]}
                        />
                      ) : null,
                  },
                ]}
              />
            </>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
