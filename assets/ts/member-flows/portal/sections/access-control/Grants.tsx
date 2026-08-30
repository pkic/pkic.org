import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { RowActions } from "../../../../components/RowActions";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { fmt, toast } from "../../ui";
import { PERMISSIONS } from "../../../../../shared/schemas/permissions";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { TargetPicker, type PickedTarget } from "./TargetPicker";
import type { AccessGrant } from "../../../../../shared/schemas/access-control";
import {
  accessGrantCreateResponseSchema,
  accessGrantsListResponseSchema,
} from "../../../../../shared/schemas/access-control";

/** Access Control section: grant/revoke permissions per user, with context and expiry pickers. */
export function Grants({ canGrant = true, canRevoke = true }: { canGrant?: boolean; canRevoke?: boolean } = {}) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [creating, setCreating] = useState(false);
  const [user, setUser] = useState<PickedUser | null>(null);
  const [permission, setPermission] = useState<string>(PERMISSIONS[0]);
  const [target, setTarget] = useState<PickedTarget>({ targetType: null, targetId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  async function handleAdd(e: Event) {
    e.preventDefault();
    if (!user) {
      toast("Pick a user first", "error");
      return;
    }
    if (target.targetType && !target.targetId) {
      toast("Pick a specific event/working group, or clear the context", "error");
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        "/api/v1/permissions/grants",
        {
          userId: user.id,
          permission,
          contextType: target.targetType,
          contextId: target.targetId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
        accessGrantCreateResponseSchema,
      );
      toast("Permission granted", "success");
      setUser(null);
      setTarget({ targetType: null, targetId: null });
      setExpiresAt("");
      setCreating(false);
      await tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {canGrant && !creating && (
        <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <button type="button" class="btn btn-sm btn-success" onClick={() => setCreating(true)}>
            New grant
          </button>
        </div>
      )}

      {canGrant && creating && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">Grant a permission</div>
          <div class="card-body">
            <form onSubmit={handleAdd} class="row g-2 align-items-end">
              <div class="col-md-4">
                <label class="form-label small fw-semibold">User</label>
                <UserPicker
                  endpoint="/api/v1/permissions/subjects"
                  value={user}
                  onChange={setUser}
                  disabled={submitting}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small fw-semibold">Permission</label>
                <select
                  class="form-select form-select-sm"
                  value={permission}
                  onChange={(e) => setPermission((e.target as HTMLSelectElement).value)}
                  disabled={submitting}
                >
                  {PERMISSIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div class="col-md-3">
                <label class="form-label small fw-semibold">Target</label>
                <TargetPicker value={target} onChange={setTarget} disabled={submitting} />
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-semibold">Expires (optional)</label>
                <input
                  class="form-control form-control-sm"
                  type="datetime-local"
                  value={expiresAt}
                  onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
                  disabled={submitting}
                />
              </div>
              <div class="col-12 d-flex gap-2">
                <button type="submit" class="btn btn-sm btn-success" disabled={submitting}>
                  {submitting ? "Granting…" : "Grant permission"}
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  onClick={() => setCreating(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ApiDataTable
        urlState="grants"
        endpoint="/api/v1/permissions/grants"
        responseSchema={accessGrantsListResponseSchema}
        resolve={(data) => data.grants}
        resolvePage={(data) => data.page}
        paginate
        actionsRef={tableRef}
        columns={[
          {
            header: "User",
            cell: (g) => g.userEmail,
            className: "small mono",
            sort: { asc: "user_id", desc: "-user_id" },
          },
          {
            header: "Permission",
            cell: (g) => <span class="badge text-bg-secondary">{g.permission}</span>,
            sort: { asc: "permission", desc: "-permission" },
          },
          {
            header: "Context",
            cell: (g) => (g.contextType ? `${g.contextType}:${g.contextId}` : <span class="text-muted">Global</span>),
            className: "small mono",
            sort: { asc: "context_type", desc: "-context_type" },
          },
          {
            header: "Expires",
            cell: (g) => (g.expiresAt ? fmt(g.expiresAt) : <span class="text-muted">Never</span>),
            className: "small",
            sort: { asc: "expires_at", desc: "-expires_at" },
          },
          {
            header: "Granted",
            cell: (g) => fmt(g.createdAt),
            className: "small mono",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            header: "",
            cell: (g) =>
              canRevoke ? (
                <RowActions
                  actions={[{ key: "revoke", label: "Revoke grant", onSelect: () => void handleRevoke(g) }]}
                />
              ) : null,
          },
        ]}
        empty={
          canGrant ? (
            <EmptyState
              title="No permission grants yet"
              body="Grant a permission to give someone access without assigning a full role."
              action={{ label: "New grant", onSelect: () => setCreating(true) }}
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
