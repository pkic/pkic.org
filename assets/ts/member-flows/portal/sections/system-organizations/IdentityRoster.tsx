import { useRef, useState } from "preact/hooks";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { FormActions } from "../../../../components/FormActions";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { postJson } from "../../../../shared/api-client";
import { ActingIdentityDirectory } from "../OrganizationIdentityDirectory";
import { toast } from "../../ui";

/** Associate a user the system already knows without re-entering their identity. */
function LinkExistingUserForm({
  organizationId,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: Event) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        {
          userReference: "existing_user",
          userId: user.id,
          activation: { mode: "invitation" },
          showOnOrganizationProfile: true,
        },
        identityMutationResponseSchema,
      );
      toast("Identity invitation sent", "success");
      await onAdded();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="row g-2 align-items-end" onSubmit={submit}>
      <div class="col-md-6">
        <label class="form-label small">Existing user</label>
        <UserPicker value={user} onChange={setUser} disabled={busy} />
      </div>
      <div class="col-md-3">
        <FormActions submitLabel="Link" busyLabel="Linking…" busy={busy || !user} onCancel={onCancel} status={error} />
      </div>
    </form>
  );
}

function AddIdentityForm({
  organizationId,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        {
          userReference: "email",
          name: name.trim(),
          email: email.trim(),
          ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
          ...(links.length > 0 ? { links } : {}),
          showOnOrganizationProfile: true,
        },
        identityMutationResponseSchema,
      );
      toast("Identity invitation sent", "success");
      await onAdded();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="row g-2 align-items-end" onSubmit={submit}>
      <div class="col-md-3">
        <label class="form-label small" for="organization-identity-name">
          Name
        </label>
        <input
          id="organization-identity-name"
          class="form-control form-control-sm"
          value={name}
          onInput={(event) => setName((event.target as HTMLInputElement).value)}
          required
          disabled={busy}
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small" for="organization-identity-email">
          Email
        </label>
        <input
          id="organization-identity-email"
          class="form-control form-control-sm"
          type="email"
          value={email}
          onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          required
          disabled={busy}
        />
      </div>
      <div class="col-md-2">
        <label class="form-label small" for="organization-identity-job-title">
          Job title
        </label>
        <input
          id="organization-identity-job-title"
          class="form-control form-control-sm"
          value={jobTitle}
          onInput={(event) => setJobTitle((event.target as HTMLInputElement).value)}
          disabled={busy}
        />
      </div>
      <div class="col-md-2">
        <label class="form-label small">Profile links</label>
        <ProfileLinksInput fieldName="identity.links" value={links} onChange={setLinks} />
      </div>
      <div class="col-md-2">
        <FormActions submitLabel="Add" busyLabel="Adding…" busy={busy} onCancel={onCancel} status={error} />
      </div>
    </form>
  );
}

export function IdentityRoster({
  organization,
  canManageIdentities,
  onChanged,
}: {
  organization: OrganizationDetail;
  canManageIdentities: boolean;
  onChanged: () => Promise<void>;
}) {
  const [addMode, setAddMode] = useState<"closed" | "link" | "email">("closed");
  const directoryRef = useRef<ApiTableActions | null>(null);
  const closeAdd = () => setAddMode("closed");
  const afterAdded = async () => {
    closeAdd();
    await onChanged();
    await directoryRef.current?.reload();
  };

  return (
    <section class="card border-0 shadow-sm" aria-labelledby="organization-identities-heading">
      <div class="card-header bg-white fw-semibold d-flex align-items-center justify-content-between gap-2">
        <span id="organization-identities-heading">Identities</span>
        {canManageIdentities && (
          <div class="d-flex gap-2">
            <button
              type="button"
              class="btn btn-sm btn-outline-success"
              onClick={() => setAddMode((current) => (current === "link" ? "closed" : "link"))}
            >
              {addMode === "link" ? "Cancel" : "Link existing user"}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-success"
              onClick={() => setAddMode((current) => (current === "email" ? "closed" : "email"))}
            >
              {addMode === "email" ? "Cancel" : "Add new person"}
            </button>
          </div>
        )}
      </div>
      {addMode === "link" && canManageIdentities && (
        <div class="card-body border-bottom p-3">
          <LinkExistingUserForm organizationId={organization.id} onAdded={afterAdded} onCancel={closeAdd} />
        </div>
      )}
      {addMode === "email" && canManageIdentities && (
        <div class="card-body border-bottom p-3">
          <AddIdentityForm organizationId={organization.id} onAdded={afterAdded} onCancel={closeAdd} />
        </div>
      )}
      <div class="card-body p-3">
        <ActingIdentityDirectory
          organizationId={organization.id}
          activeIdentities={organization.identities}
          canManage={canManageIdentities}
          onChanged={onChanged}
          actionsRef={directoryRef}
        />
      </div>
    </section>
  );
}
