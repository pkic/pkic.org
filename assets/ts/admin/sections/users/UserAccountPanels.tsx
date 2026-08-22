import { useRef, useState } from "preact/hooks";
import { api } from "../../api";
import { fmt, toast } from "../../ui";
import { ApiDataTable, type ApiTableActions } from "../../components/ApiDataTable";
import { type UserEmailRecord, userEmailsListResponseSchema } from "../../../../shared/schemas/user-emails";

export function UserEmailAddressesPanel({ userId, primaryEmail }: { userId: string; primaryEmail: string }) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd(event: Event) {
    event.preventDefault();
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await api(`/api/v1/admin/users/${userId}/emails`, { method: "POST", body: JSON.stringify({ email: trimmed }) });
      toast("Email added", "success");
      setNewEmail("");
      tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(emailId: string, email: string) {
    if (!confirm(`Remove ${email} from this account?`)) return;
    try {
      await api(`/api/v1/admin/users/${userId}/emails/${emailId}`, { method: "DELETE" });
      toast("Email removed", "success");
      tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Email addresses</div>
      <div class="card-body p-3">
        <div class="small text-muted mb-2">
          Secondary emails are for admin search and record-keeping only — they do not allow logging in.
        </div>
        <dl class="row mb-3">
          <dt class="col-sm-2 text-muted small">Primary</dt>
          <dd class="col-sm-10 mb-0">{primaryEmail}</dd>
        </dl>
        <form onSubmit={handleAdd} class="d-flex gap-2 mb-3">
          <input
            type="email"
            class="form-control form-control-sm adm-email-input"
            placeholder="another@example.com"
            value={newEmail}
            onInput={(event) => setNewEmail((event.target as HTMLInputElement).value)}
            disabled={adding}
          />
          <button type="submit" class="btn btn-sm btn-outline-success" disabled={adding || !newEmail.trim()}>
            {adding ? "Adding…" : "Add email"}
          </button>
        </form>
        <ApiDataTable<UserEmailRecord>
          endpoint={`/api/v1/admin/users/${userId}/emails`}
          responseSchema={userEmailsListResponseSchema}
          resolve={(response) => userEmailsListResponseSchema.parse(response).emails}
          resolvePage={(response) => userEmailsListResponseSchema.parse(response).page}
          paginate
          initialPageSize={10}
          initialSort="email"
          searchPlaceholder="Search secondary emails…"
          actionsRef={tableRef}
          rowKey={(email) => email.id}
          empty="No secondary emails"
          columns={[
            {
              header: "Secondary email",
              cell: (email) => email.email,
              sort: { asc: "email", desc: "-email" },
            },
            {
              header: "Added",
              cell: (email) => <span class="small mono">{fmt(email.createdAt)}</span>,
              sort: { asc: "created_at", desc: "-created_at" },
            },
            {
              header: "",
              cell: (email) => (
                <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRemove(email.id, email.email)}>
                  Remove
                </button>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
