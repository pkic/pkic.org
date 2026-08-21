import { useCallback, useEffect, useState } from "preact/hooks";
import { UserPicker, type PickedUser } from "../access-control/UserPicker";
import { api } from "../../api";
import { toast } from "../../ui";

interface UserEmailRecord {
  id: string;
  email: string;
  createdAt: string;
}

export function UserEmailAddressesPanel({ userId, primaryEmail }: { userId: string; primaryEmail: string }) {
  const [emails, setEmails] = useState<UserEmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ emails: UserEmailRecord[] }>(`/api/v1/admin/users/${userId}/emails`);
      setEmails(data.emails);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(event: Event) {
    event.preventDefault();
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await api(`/api/v1/admin/users/${userId}/emails`, { method: "POST", body: JSON.stringify({ email: trimmed }) });
      toast("Email added", "success");
      setNewEmail("");
      await load();
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
      await load();
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
        <table class="table table-sm table-borderless mb-2">
          <tbody>
            <tr>
              <th class="text-muted small adm-user-info-label">Primary</th>
              <td>{primaryEmail}</td>
            </tr>
            {emails.map((email) => (
              <tr key={email.id}>
                <th class="text-muted small adm-user-info-label">Secondary</th>
                <td>
                  {email.email}{" "}
                  <button
                    class="btn btn-sm btn-outline-danger ms-2"
                    onClick={() => void handleRemove(email.id, email.email)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && (
          <form onSubmit={handleAdd} class="d-flex gap-2">
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
      </div>
    </div>
  );
}

export function MergeUserAccountPanel({ userId, onMerged }: { userId: string; onMerged: () => Promise<void> | void }) {
  const [sourceUser, setSourceUser] = useState<PickedUser | null>(null);
  const [merging, setMerging] = useState(false);

  async function handleMerge() {
    if (!sourceUser) return;
    if (
      !confirm(
        `Merge ${sourceUser.email} into this account? Its memberships, working groups, roles, and passkeys transfer here, its email is kept as a secondary email, and that account is anonymized. This cannot be undone from the UI.`,
      )
    ) {
      return;
    }
    setMerging(true);
    try {
      await api(`/api/v1/admin/users/${userId}/merge`, {
        method: "POST",
        body: JSON.stringify({ sourceUserId: sourceUser.id }),
      });
      toast("Accounts merged", "success");
      setSourceUser(null);
      await onMerged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setMerging(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Merge another account into this one</div>
      <div class="card-body p-3">
        <div class="small text-muted mb-2">
          Use this to fold a duplicate account into this one — its memberships, working groups, roles, and passkeys
          transfer here, and its email is kept as a secondary email above.
        </div>
        <div class="d-flex gap-2 align-items-end">
          <div class="adm-user-merge-picker">
            <UserPicker
              value={sourceUser}
              onChange={setSourceUser}
              disabled={merging}
              placeholder="Find the duplicate account…"
            />
          </div>
          <button class="btn btn-sm btn-danger" disabled={merging || !sourceUser} onClick={() => void handleMerge()}>
            {merging ? "Merging…" : "Merge into this account"}
          </button>
        </div>
      </div>
    </div>
  );
}
