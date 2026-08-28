import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { fmt, toast } from "../../ui";
import { PERMISSIONS } from "../../../../../shared/schemas/permissions";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { ContextPicker, type PickedContext } from "./ContextPicker";
import {
  accessGrantCreateResponseSchema,
  accessGrantsListResponseSchema,
} from "../../../../../shared/schemas/access-control";

/** Access Control section: grant/revoke permissions per user, with context and expiry pickers. */
export function Grants({ canGrant = true, canRevoke = true }: { canGrant?: boolean; canRevoke?: boolean } = {}) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [user, setUser] = useState<PickedUser | null>(null);
  const [permission, setPermission] = useState<string>(PERMISSIONS[0]);
  const [context, setContext] = useState<PickedContext>({ contextType: null, contextId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this permission grant?")) return;
    try {
      await deleteJson(`/api/v1/system/access-control/grants/${id}`, successResponseSchema);
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
    if (context.contextType && !context.contextId) {
      toast("Pick a specific event/working group, or clear the context", "error");
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        "/api/v1/system/access-control/grants",
        {
          userId: user.id,
          permission,
          contextType: context.contextType,
          contextId: context.contextId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
        accessGrantCreateResponseSchema,
      );
      toast("Permission granted", "success");
      setUser(null);
      setContext({ contextType: null, contextId: null });
      setExpiresAt("");
      await tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {canGrant && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">Grant a permission</div>
          <div class="card-body">
            <form onSubmit={handleAdd} class="row g-2 align-items-end">
              <div class="col-md-4">
                <label class="form-label small fw-semibold">User</label>
                <UserPicker
                  endpoint="/api/v1/system/access-control/users"
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
                <label class="form-label small fw-semibold">Context</label>
                <ContextPicker value={context} onChange={setContext} disabled={submitting} />
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
              <div class="col-12">
                <button type="submit" class="btn btn-sm btn-success" disabled={submitting}>
                  {submitting ? "Granting…" : "Grant permission"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ApiDataTable
        endpoint="/api/v1/system/access-control/grants"
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
                <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(g.id)}>
                  Revoke
                </button>
              ) : null,
          },
        ]}
        empty="No permission grants"
        rowKey={(g) => g.id}
      />
    </div>
  );
}
