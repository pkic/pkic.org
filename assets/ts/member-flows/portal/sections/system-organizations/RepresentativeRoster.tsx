import { useState } from "preact/hooks";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { representativeMutationResponseSchema } from "../../../../../shared/schemas/organization-representation";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { FormActions } from "../../../../components/FormActions";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { deleteJson, patchJson, postJson } from "../../../../shared/api-client";
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

function RepresentativeVisibility({
  organizationId,
  representative,
  onChanged,
}: {
  organizationId: string;
  representative: OrganizationDetail["representatives"][number];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function updateVisibility(showOnOrganizationProfile: boolean) {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives/${encodeURIComponent(representative.userId)}`,
        { showOnOrganizationProfile },
        successResponseSchema,
      );
      await onChanged();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${representative.name} as a representative? Their user account is not deleted.`)) return;
    setBusy(true);
    try {
      await deleteJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives/${encodeURIComponent(representative.userId)}`,
        successResponseSchema,
      );
      toast("Representative removed", "success");
      await onChanged();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <td class="text-center">
        <input
          aria-label={`Show ${representative.name} on organization profile`}
          type="checkbox"
          class="form-check-input"
          checked={representative.showOnOrgProfile}
          disabled={busy}
          onChange={(event) => void updateVisibility((event.target as HTMLInputElement).checked)}
        />
      </td>
      <td class="text-end">
        <button type="button" class="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => void remove()}>
          Remove
        </button>
      </td>
    </>
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
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}
      <div class="table-responsive">
        <table class="table table-sm table-hover mb-0">
          <thead class="table-dark">
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Contact role</th>
              {canManageRepresentatives && (
                <th scope="col" class="text-center">
                  On profile
                </th>
              )}
              {canManageRepresentatives && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {organization.representatives.length === 0 ? (
              <tr>
                <td colSpan={canManageRepresentatives ? 5 : 3} class="text-center text-muted fst-italic py-3">
                  No representatives
                </td>
              </tr>
            ) : (
              organization.representatives.map((representative) => (
                <tr key={representative.representativeId}>
                  <td>
                    <strong>{representative.name}</strong>
                    <div class="mono text-muted small">{representative.email}</div>
                    {representative.jobTitle && <div class="small text-muted">{representative.jobTitle}</div>}
                  </td>
                  <td>{representative.status}</td>
                  <td class="small">
                    {representative.isPrimaryContact && <span class="badge text-bg-primary me-1">Primary</span>}
                    {representative.isSecondaryContact && <span class="badge text-bg-info">Secondary</span>}
                  </td>
                  {canManageRepresentatives && (
                    <RepresentativeVisibility
                      organizationId={organization.id}
                      representative={representative}
                      onChanged={onChanged}
                    />
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
