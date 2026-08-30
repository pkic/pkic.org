import { useRef, useState } from "preact/hooks";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { representativeMutationResponseSchema } from "../../../../../shared/schemas/organization-representation";
import { FormActions } from "../../../../components/FormActions";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { postJson } from "../../../../shared/api-client";
import { OrganizationRepresentativeDirectory } from "../OrganizationRepresentativeDirectory";
import { toast } from "../../ui";

function AddRepresentativeForm({
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
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives`,
        {
          kind: "email",
          name: name.trim(),
          email: email.trim(),
          ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
          ...(links.length > 0 ? { links } : {}),
          showOnOrganizationProfile: true,
        },
        representativeMutationResponseSchema,
      );
      toast("Representative added", "success");
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
        <label class="form-label small" for="organization-representative-name">
          Name
        </label>
        <input
          id="organization-representative-name"
          class="form-control form-control-sm"
          value={name}
          onInput={(event) => setName((event.target as HTMLInputElement).value)}
          required
          disabled={busy}
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small" for="organization-representative-email">
          Email
        </label>
        <input
          id="organization-representative-email"
          class="form-control form-control-sm"
          type="email"
          value={email}
          onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          required
          disabled={busy}
        />
      </div>
      <div class="col-md-2">
        <label class="form-label small" for="organization-representative-job-title">
          Job title
        </label>
        <input
          id="organization-representative-job-title"
          class="form-control form-control-sm"
          value={jobTitle}
          onInput={(event) => setJobTitle((event.target as HTMLInputElement).value)}
          disabled={busy}
        />
      </div>
      <div class="col-md-2">
        <label class="form-label small">Profile links</label>
        <ProfileLinksInput fieldName="representative.links" value={links} onChange={setLinks} />
      </div>
      <div class="col-md-2">
        <FormActions submitLabel="Add" busyLabel="Adding…" busy={busy} onCancel={onCancel} status={error} />
      </div>
    </form>
  );
}

export function RepresentativeRoster({
  organization,
  canManageRepresentatives,
  onChanged,
}: {
  organization: OrganizationDetail;
  canManageRepresentatives: boolean;
  onChanged: () => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const directoryRef = useRef<ApiTableActions | null>(null);

  return (
    <section class="card border-0 shadow-sm" aria-labelledby="organization-representatives-heading">
      <div class="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
        <span id="organization-representatives-heading">Representatives</span>
        {canManageRepresentatives && (
          <button type="button" class="btn btn-sm btn-success" onClick={() => setShowAdd((current) => !current)}>
            {showAdd ? "Cancel" : "Add representative"}
          </button>
        )}
      </div>
      {showAdd && canManageRepresentatives && (
        <div class="card-body border-bottom p-3">
          <AddRepresentativeForm
            organizationId={organization.id}
            onAdded={async () => {
              setShowAdd(false);
              await onChanged();
              await directoryRef.current?.reload();
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}
      <div class="card-body p-3">
        <OrganizationRepresentativeDirectory
          organizationId={organization.id}
          activeRepresentatives={organization.representatives}
          canManage={canManageRepresentatives}
          onChanged={onChanged}
          actionsRef={directoryRef}
        />
      </div>
    </section>
  );
}
