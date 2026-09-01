import { Fragment } from "preact";
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
import { fmt, toast } from "../../ui";
import { UserEmailAddressesPanel } from "./UserAccountPanels";
import { UserMembershipPanel } from "./UserMembershipPanel";
import { UserProfileEditor } from "./UserProfileEditor";
import type { UserDetail as UserDetailModel } from "./model";
import { Badge } from "../../../../components/Badge";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody } from "../../../../ui/Panel";
// `pk-datalist`, `pk-break` and `pk-nowrap`'s neighbours ship in a component
// chunk rather than the entry stylesheet, so the module that writes those
// class names is the one that has to pull the sheet in.
import "../../../../ui/Content.css";

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
  const nameFields: Array<[string, string | null | undefined]> = [
    ["Email", user.email],
    ["First name", user.first_name],
    ["Last name", user.last_name],
    ["Preferred name", user.preferred_name],
  ];

  return (
    <div class="pk pk-stack">
      {/* The name heads the record, so it is a real heading. It used to be a
          `<span>` carrying a legacy `page-heading` class, which left the page
          with no entry in the document outline at all. */}
      <div class="pk-cluster">
        <Button size="sm" onClick={onBack}>
          ← Back to list
        </Button>
        <h2>{displayName}</h2>
      </div>

      {user.pii_redacted_at && (
        /* The redaction used to be a red date in the table, which is a state
           told by colour alone. The words carry it now and the tone only
           reinforces them. */
        <Alert tone="danger" title="This account has been anonymized">
          Personal details were erased on {fmt(user.pii_redacted_at)} and cannot be restored. The membership and event
          records that remain no longer identify this person.
        </Alert>
      )}

      <div class="pk-grid pk-grid--roomy">
        <Panel>
          <PanelBody>
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
          </PanelBody>
        </Panel>

        <Panel>
          <PanelBody class="pk-stack">
            {/* A description list, not a borderless two-column table: this is
                one record's fields, and an unnamed table is announced as a
                table on a page that already has several. */}
            <dl class="pk-datalist pk-small">
              {nameFields.map(([label, value]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd class="pk-break">{value || "—"}</dd>
                </Fragment>
              ))}
              <dt>Role</dt>
              <dd>
                <Badge status={user.role} />
              </dd>
              <dt>Active</dt>
              <dd>{user.active ? "Yes" : "No"}</dd>
              <dt>Created</dt>
              <dd class="pk-nowrap">{fmt(user.created_at)}</dd>
            </dl>

            {editable && <UserProfileEditor user={user} canGrantAccess={permissions.canGrantAccess} onSaved={load} />}

            {permissions.canAnonymize && !user.pii_redacted_at && (
              <div class="pk-cluster">
                {/* `loading` rather than `disabled`: a disabled control loses
                    focus, which throws a screen-reader user out of the record
                    they were working on mid-request. */}
                <Button variant="danger-quiet" size="sm" loading={anonymizing} onClick={() => void anonymize()}>
                  {anonymizing ? "Anonymizing…" : "Anonymize user"}
                </Button>
              </div>
            )}
          </PanelBody>
        </Panel>
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
