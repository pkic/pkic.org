import { useEffect, useState } from "preact/hooks";
import {
  organizationActiveSponsorshipResponseSchema,
  organizationSecondaryContactNominationResponseSchema,
} from "../../../../shared/schemas/organization-self-service";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { ApiClientError, deleteJson, getJson, putJson } from "../../../shared/api-client";
import { profile as profileSignal } from "../state";
import type { MyOrganizationProfile, MyOrganizationSponsorship } from "../types";
import { toast } from "../ui";

function organizationPath(organizationId: string): string {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}`;
}

function SecondaryContactSection({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  const representatives = (profileSignal.value?.organizationRepresentatives ?? []).filter(
    (representative) => !representative.isPrimaryContact,
  );
  const [value, setValue] = useState(org.pendingSecondaryContactUserId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(org.pendingSecondaryContactUserId ?? ""), [org.pendingSecondaryContactUserId]);

  async function handleChange(next: string): Promise<void> {
    setValue(next);
    setSaving(true);
    try {
      const path = `${organizationPath(organizationId)}/contacts/secondary/nomination`;
      if (next) {
        await putJson(path, { userId: next }, organizationSecondaryContactNominationResponseSchema);
      } else {
        await deleteJson(path, organizationSecondaryContactNominationResponseSchema);
      }
      toast(next ? "Secondary contact nominated — pending staff confirmation" : "Nomination withdrawn", "success");
      await reload();
    } catch (error) {
      setValue(org.pendingSecondaryContactUserId ?? "");
      toast(error instanceof ApiClientError ? error.message : "Could not update nomination.", "error");
    } finally {
      setSaving(false);
    }
  }

  const nominee = representatives.find((representative) => representative.userId === org.pendingSecondaryContactUserId);
  return (
    <div>
      <h3 class="h6">Secondary contact</h3>
      <p class="text-muted small">
        A second representative who can manage the organization profile. Nominations are held until confirmed by staff.
      </p>
      {org.isPrimaryContact ? (
        <RepresentativeSelect
          className="portal-representative-select"
          value={value}
          disabled={saving}
          emptyLabel="None"
          representatives={representatives}
          onChange={(event) => void handleChange((event.target as HTMLSelectElement).value)}
        />
      ) : (
        <p class="mb-0 small">
          {org.pendingSecondaryContactUserId
            ? `Pending: ${nominee?.name ?? nominee?.email ?? "a representative"}`
            : "None pending"}
        </p>
      )}
    </div>
  );
}

export function RepresentativeSelect({
  className,
  value,
  disabled,
  emptyLabel,
  representatives,
  onChange,
}: {
  className: string;
  value: string;
  disabled: boolean;
  emptyLabel: string;
  representatives: Array<{ userId: string; name: string | null; email: string }>;
  onChange: (event: Event) => void;
}) {
  return (
    <select class={`form-select form-select-sm ${className}`} value={value} disabled={disabled} onChange={onChange}>
      <option value="">{emptyLabel}</option>
      {representatives.map((representative) => (
        <option key={representative.userId} value={representative.userId}>
          {representative.name ?? representative.email}
        </option>
      ))}
    </select>
  );
}

export function OrganizationGovernanceCard({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Governance</div>
      <div class="card-body d-flex flex-column gap-4">
        <SecondaryContactSection organizationId={organizationId} org={org} reload={reload} />
      </div>
    </div>
  );
}

export function OrganizationSponsorshipCard({ organizationId }: { organizationId: string }) {
  const [sponsorship, setSponsorship] = useState<MyOrganizationSponsorship | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson(`${organizationPath(organizationId)}/sponsorships/current`, organizationActiveSponsorshipResponseSchema)
      .then((response) => setSponsorship(response.sponsorship))
      .catch((cause: unknown) =>
        setError(cause instanceof ApiClientError ? cause.message : "Could not load sponsorship."),
      );
  }, [organizationId]);

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Sponsorship</div>
      <div class="card-body">
        {error && <ErrorAlert error={error} />}
        {!sponsorship && !error ? (
          <Spinner />
        ) : sponsorship?.tier ? (
          <p class="mb-0">
            Active <span class="fw-semibold text-capitalize">{sponsorship.tier}</span> sponsor
            {sponsorship.startDate && <> since {new Date(sponsorship.startDate).toLocaleDateString()}</>}.
          </p>
        ) : (
          <p class="text-muted mb-0">Your organization is not currently a consortium sponsor.</p>
        )}
      </div>
    </div>
  );
}
