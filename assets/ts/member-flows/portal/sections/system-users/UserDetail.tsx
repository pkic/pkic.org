import { useCallback, useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { deleteJson, getJson, postJson, requestJson } from "../../../../shared/api-client";
import { confirmHeadshotUsage } from "../../../../shared/headshot/controller";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../../../shared/headshot/AdminHeadshotManager";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { userAnonymizeResponseSchema, userDetailResponseSchema } from "../../../../../shared/schemas/user-management";
import { userGravatarImportResponseSchema } from "../../../../../shared/schemas/route-contracts-headshots";
import { toast } from "../../ui";
import { UserEmailAddressesPanel } from "./UserAccountPanels";
import { UserMembershipPanel } from "./UserMembershipPanel";
import { UserProfileEditor } from "./UserProfileEditor";
import type { UserDetail as UserDetailModel } from "./model";

const ROLE_COLOR: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };

export interface UserPermissions {
  canRead: boolean;
  canWrite: boolean;
  canGrantAccess: boolean;
  canAnonymize: boolean;
  canManageMembership: boolean;
  canActivateIdentity: boolean;
}

export function UserDetail({
  userId,
  onBack,
  permissions,
}: {
  userId: string;
  onBack: () => void;
  permissions: UserPermissions;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDetailModel | null>(null);
  const [headshotStatus, setHeadshotStatus] = useState("");
  const [anonymizing, setAnonymizing] = useState(false);

  const load = useCallback(async () => {
    if (!permissions.canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getJson(`/api/v1/users/${encodeURIComponent(userId)}`, userDetailResponseSchema);
      setUser(data.user);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [permissions.canRead, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadHeadshot(file: Blob) {
    if (!user) return;
    await requestJson(`/api/v1/users/${encodeURIComponent(user.id)}/headshot`, successResponseSchema, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  }

  async function fetchGravatar() {
    if (!user) return;
    const accepted = await confirmHeadshotUsage({
      title: "Before uploading a photo",
      texts: ADMIN_HEADSHOT_DISCLAIMER,
      confirmText: "Proceed",
    });
    if (!accepted) return;
    setHeadshotStatus("Looking up Gravatar…");
    try {
      await postJson(`/api/v1/users/${encodeURIComponent(user.id)}/gravatar`, {}, userGravatarImportResponseSchema);
      toast("Gravatar imported successfully", "success");
      await load();
    } catch (cause) {
      const message = (cause as Error).message;
      toast(message, "error");
      setHeadshotStatus(`Error: ${message}`);
    }
  }

  async function anonymize() {
    if (!user) return;
    const confirmed = await confirmAction({
      title: `Anonymize ${user.email}?`,
      body: "This is permanent and cannot be undone.",
      consequences: [
        "Their name, email, biography, links, and headshot are permanently erased",
        "Their sign-in access is revoked immediately",
        "Their membership and event history records are kept, but no longer identify them",
      ],
      confirmLabel: "Anonymize user",
      typedConfirmation: user.email,
    });
    if (!confirmed) return;
    setAnonymizing(true);
    try {
      await postJson(`/api/v1/users/${encodeURIComponent(user.id)}/anonymize`, {}, userAnonymizeResponseSchema);
      toast("User anonymized", "success");
      await load();
    } catch (cause) {
      toast((cause as Error).message, "error");
    } finally {
      setAnonymizing(false);
    }
  }

  if (!permissions.canRead) {
    return <ErrorAlert error="You need Users read permission to open a user record." />;
  }
  if (loading) return <Spinner label="Loading user…" />;
  if (error) return <ErrorAlert error={error} />;
  if (!user) return null;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const editable = permissions.canWrite && !user.pii_redacted_at;

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← Back to list
        </button>
        <span class="page-heading mb-0">{displayName}</span>
      </div>
      <div class="row g-4">
        <div class="col-md-4 text-center">
          <AdminHeadshotManager
            initialUrl={user.headshotUrl}
            alt="Headshot"
            emptyLabel="User"
            statusText={headshotStatus}
            readOnly={!editable}
            uploadHeadshot={uploadHeadshot}
            deleteHeadshot={async () => {
              await deleteJson(`/api/v1/users/${encodeURIComponent(user.id)}/headshot`, successResponseSchema);
            }}
            onFetchGravatar={editable ? fetchGravatar : undefined}
            onUploaded={async () => {
              toast("Headshot uploaded", "success");
              await load();
            }}
            onDeleted={async () => {
              toast("Headshot removed", "success");
              await load();
            }}
            onError={(message) => toast(message, "error")}
            confirmDeleteMessage="Remove this user's headshot?"
          />
        </div>
        <div class="col-md-8">
          <div class="card border-0 shadow-sm">
            <div class="card-body p-3">
              <table class="table table-sm table-borderless mb-0">
                <tbody>
                  {(
                    [
                      ["Email", user.email],
                      ["First name", user.first_name],
                      ["Last name", user.last_name],
                      ["Preferred name", user.preferred_name],
                    ] as Array<[string, string | null | undefined]>
                  ).map(([label, value]) => (
                    <tr key={label}>
                      <th class="text-muted small adm-user-info-label">{label}</th>
                      <td>{value || "—"}</td>
                    </tr>
                  ))}
                  <tr>
                    <th class="text-muted small adm-user-info-label">Role</th>
                    <td>
                      <span class={`badge text-bg-${ROLE_COLOR[user.role] ?? "secondary"}`}>{user.role}</span>
                    </td>
                  </tr>
                  <tr>
                    <th class="text-muted small adm-user-info-label">Active</th>
                    <td>{user.active ? "Yes" : "No"}</td>
                  </tr>
                  <tr>
                    <th class="text-muted small adm-user-info-label">Created</th>
                    <td>{new Date(user.created_at).toLocaleString("en-US")}</td>
                  </tr>
                  {user.pii_redacted_at && (
                    <tr>
                      <th class="text-muted small adm-user-info-label">PII redacted</th>
                      <td class="text-danger">{new Date(user.pii_redacted_at).toLocaleString("en-US")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {editable && <UserProfileEditor user={user} canGrantAccess={permissions.canGrantAccess} onSaved={load} />}
              {permissions.canAnonymize && !user.pii_redacted_at && (
                <button
                  class="btn btn-sm btn-outline-danger mt-3"
                  onClick={() => void anonymize()}
                  disabled={anonymizing}
                >
                  {anonymizing ? "Anonymizing…" : "Anonymize user"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <UserMembershipPanel
        user={user}
        onChanged={load}
        canManage={permissions.canManageMembership}
        canActivate={permissions.canActivateIdentity}
      />
      <UserEmailAddressesPanel userId={user.id} primaryEmail={user.email} canWrite={permissions.canWrite} />
    </div>
  );
}
