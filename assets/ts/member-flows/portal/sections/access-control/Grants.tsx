import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { Alert } from "../../../../ui/Alert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { Select, TextInput } from "../../../../ui/TextControl";
import { useContractForm } from "../../../../hooks/useContractForm";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { fmt, fmtDate, toast } from "../../ui";
import { PERMISSIONS } from "../../../../../shared/schemas/permissions";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { TargetPicker, type PickedTarget } from "./TargetPicker";
import type { AccessGrant } from "../../../../../shared/schemas/access-control";
import {
  accessGrantCreateResponseSchema,
  accessGrantCreateSchema,
  accessGrantsListResponseSchema,
} from "../../../../../shared/schemas/access-control";
// A permission name and a context reference are identifiers, so their cells
// are set in `pk-mono`. That class lives in the content stylesheet, and
// component CSS ships in lazy chunks — the surface writing the class name
// imports the sheet itself.
import "../../../../ui/Content.css";

/** Access Control section: grant/revoke permissions per user, with context and expiry pickers. */
export function Grants({ canGrant = true, canRevoke = true }: { canGrant?: boolean; canRevoke?: boolean } = {}) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [creating, setCreating] = useState(false);
  const [user, setUser] = useState<PickedUser | null>(null);
  const [permission, setPermission] = useState<string>(PERMISSIONS[0]);
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

  async function handleRevoke(grant: AccessGrant) {
    const confirmed = await confirmAction({
      title: `Revoke the "${grant.permission}" grant from ${grant.userEmail}?`,
      consequences: [`${grant.userEmail} immediately loses this permission`],
      confirmLabel: "Revoke grant",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`/api/v1/permissions/grants/${grant.id}`, successResponseSchema);
      toast("Grant revoked", "success");
      await tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  function closeForm() {
    setCreating(false);
    setFormError(null);
  }

  /*
   * One basis for validation: `accessGrantCreateSchema`, the contract the
   * route parses. It carries the same "a context type and a context id arrive
   * together" rule this form used to restate in its own words.
   */
  const form = useContractForm(accessGrantCreateSchema, {
    userId: user?.id,
    permission,
    contextType: target.targetType,
    contextId: target.targetId,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
  });

  async function handleAdd(e: Event) {
    e.preventDefault();
    setFormError(null);
    /*
     * The picker is not a contract-wired control, so a refusal naming `userId`
     * would show "correct the highlighted fields" with nothing highlighted.
     * Named here, in the words of the thing that is missing; everything the
     * request carries is still checked by the contract below.
     */
    if (!user) {
      setFormError("Pick a user first.");
      return;
    }
    const checked = form.submit();
    if (!checked.data) {
      setFormError(checked.message);
      return;
    }
    setSubmitting(true);
    try {
      await postJson("/api/v1/permissions/grants", checked.data, accessGrantCreateResponseSchema);
      toast("Permission granted", "success");
      setUser(null);
      setTarget({ targetType: null, targetId: null });
      setExpiresAt("");
      form.reset();
      closeForm();
      await tableRef.current?.reload();
    } catch (error) {
      // A server refusal names its fields the way the contract does.
      setFormError(form.refuse(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="pk pk-stack">
      {canGrant && creating && (
        <Panel>
          <PanelHeader title="Grant a permission" />
          <PanelBody>
            <form
              noValidate
              class="pk-stack"
              aria-label="Grant a permission"
              {...form.handlers}
              onSubmit={(e) => void handleAdd(e)}
            >
              {/* One `disabled` takes the whole form out of play while the
                  request is in flight, including the pickers this surface
                  cannot reach a prop into. */}
              <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={submitting}>
                {/* The people search is several controls, so it is named by a
                    legend rather than by a label with no single control to
                    point its `for` at. */}
                <fieldset class="pk-fieldset pk-field">
                  <legend class="pk-field__label">User</legend>
                  <UserPicker
                    endpoint="/api/v1/permissions/subjects"
                    value={user}
                    onChange={setUser}
                    disabled={submitting}
                  />
                </fieldset>
                <Field label="Permission" {...form.of("permission")}>
                  {(control) => (
                    <Select
                      {...control}
                      value={permission}
                      onChange={(e) => setPermission((e.target as HTMLSelectElement).value)}
                      disabled={submitting}
                    >
                      {PERMISSIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <fieldset class="pk-fieldset pk-field">
                  <legend class="pk-field__label">Target</legend>
                  <TargetPicker value={target} onChange={setTarget} disabled={submitting} />
                </fieldset>
                <Field
                  label="Expires (optional)"
                  help="Leave empty for a grant that never expires."
                  {...form.of("expiresAt")}
                >
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
                <Button type="submit" variant="primary" size="sm" loading={submitting}>
                  {submitting ? "Granting…" : "Grant permission"}
                </Button>
                <Button variant="secondary" size="sm" disabled={submitting} onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      )}

      <ApiDataTable
        caption="Permission grants"
        urlState="grants"
        endpoint="/api/v1/permissions/grants"
        responseSchema={accessGrantsListResponseSchema}
        resolve={(data) => data.grants}
        resolvePage={(data) => data.page}
        paginate
        actionsRef={tableRef}
        createAction={
          canGrant ? { label: "New grant", onSelect: () => setCreating(true), disabled: creating } : undefined
        }
        columns={[
          {
            header: "User",
            cell: (g) => g.userEmail,
            className: "pk-small pk-mono",
            sort: { asc: "user_id", desc: "-user_id" },
          },
          {
            header: "Permission",
            cell: (g) => (
              <Badge tone="neutral" dot={false}>
                <span class="pk-mono">{g.permission}</span>
              </Badge>
            ),
            sort: { asc: "permission", desc: "-permission" },
          },
          {
            header: "Context",
            cell: (g) => (g.contextType ? `${g.contextType}:${g.contextId}` : <span class="pk-muted">Global</span>),
            className: "pk-small pk-mono",
            sort: { asc: "context_type", desc: "-context_type" },
          },
          {
            // Dates have a bounded length; the columns say so and keep the
            // table's own ink and size, leaving the slack with the subject.
            header: "Expires",
            cell: (g) => (g.expiresAt ? fmt(g.expiresAt) : <span class="pk-muted">Never</span>),
            width: "fit",
            sort: { asc: "expires_at", desc: "-expires_at" },
          },
          {
            header: "Granted",
            cell: (g) => fmtDate(g.createdAt),
            width: "fit",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            header: "",
            cell: (g) =>
              canRevoke ? (
                <RowActions
                  subject={`${g.permission} granted to ${g.userEmail}`}
                  actions={[{ id: "revoke", label: "Revoke grant", onSelect: () => void handleRevoke(g) }]}
                />
              ) : null,
          },
        ]}
        empty={
          canGrant ? (
            // The toolbar above already carries "New grant"; repeating it
            // here would leave one command answering to two identically
            // named controls.
            <EmptyState
              title="No permission grants yet"
              body="Use New grant above to give someone access without assigning a full role."
            />
          ) : (
            <EmptyState title="No permission grants yet" />
          )
        }
        rowKey={(g) => g.id}
      />
    </div>
  );
}
