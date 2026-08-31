import { useRef, useState } from "preact/hooks";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  userEmailAddResponseSchema,
  userEmailsListResponseSchema,
  type UserEmailRecord,
} from "../../../../../shared/schemas/user-emails";
import { fmtDate, toast } from "../../ui";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { RowActions } from "../../../../ui/RowActions";

export function UserEmailAddressesPanel({
  userId,
  primaryEmail,
  canWrite,
}: {
  userId: string;
  primaryEmail: string;
  canWrite: boolean;
}) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd(event: Event) {
    event.preventDefault();
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await postJson(
        `/api/v1/users/${encodeURIComponent(userId)}/emails`,
        { email: trimmed },
        userEmailAddResponseSchema,
      );
      toast("Email added", "success");
      setNewEmail("");
      await tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(emailId: string, email: string) {
    const confirmed = await confirmAction({
      title: `Remove ${email} from this account?`,
      consequences: ["This secondary email is no longer associated with this account"],
      confirmLabel: "Remove email",
    });
    if (!confirmed) return;
    try {
      await deleteJson(
        `/api/v1/users/${encodeURIComponent(userId)}/emails/${encodeURIComponent(emailId)}`,
        successResponseSchema,
      );
      toast("Email removed", "success");
      await tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Email addresses</div>
      <div class="card-body p-3">
        <div class="small text-muted mb-2">
          Secondary emails are for account association and record-keeping only — they do not allow signing in.
        </div>
        <dl class="row mb-3">
          <dt class="col-sm-2 text-muted small">Primary</dt>
          <dd class="col-sm-10 mb-0">{primaryEmail}</dd>
        </dl>
        {canWrite && (
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
        )}
        <ApiDataTable
          endpoint={`/api/v1/users/${encodeURIComponent(userId)}/emails`}
          responseSchema={userEmailsListResponseSchema}
          resolve={(response) => response.emails}
          resolvePage={(response) => response.page}
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
              cell: (email) => <span class="small mono">{fmtDate(email.createdAt)}</span>,
              sort: { asc: "created_at", desc: "-created_at" },
            },
            ...(canWrite
              ? [
                  {
                    header: "",
                    cell: (email: UserEmailRecord) => (
                      <RowActions
                        actions={[
                          {
                            id: "remove",
                            label: "Remove email",
                            onSelect: () => void handleRemove(email.id, email.email),
                          },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}
