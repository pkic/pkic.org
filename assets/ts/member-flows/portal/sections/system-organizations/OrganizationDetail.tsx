import { useCallback, useEffect, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import {
  organizationDetailResponseSchema,
  type OrganizationDetail as OrganizationDetailModel,
} from "../../../../../shared/schemas/organization-management";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { getJson } from "../../../../shared/api-client";
import { OrganizationLogo } from "./OrganizationLogo";
import { OrganizationProfile } from "./OrganizationProfile";
import { RepresentativeRoster } from "./RepresentativeRoster";

export function OrganizationDetail({
  organizationId,
  canRead,
  canWrite,
  canManageRepresentatives,
}: {
  organizationId: string;
  canRead: boolean;
  canWrite: boolean;
  canManageRepresentatives: boolean;
}) {
  const [, navigate] = usePortalHashLocation();
  const [organization, setOrganization] = useState<OrganizationDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}`,
        organizationDetailResponseSchema,
      );
      setOrganization(response.organization);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canRead, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return <ErrorAlert error="Organization details require the organizations:read permission." />;
  }
  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!organization) return null;

  return (
    <section aria-labelledby="organization-detail-heading">
      <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => navigate("/organizations")}>
          ← Back to organizations
        </button>
        <h5 id="organization-detail-heading" class="mb-0">
          {organization.name}
        </h5>
        <span class="text-muted small">
          {organization.memberCount} representative{organization.memberCount === 1 ? "" : "s"}
        </span>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-md-3">
          <OrganizationLogo organization={organization} canWrite={canWrite} onChanged={load} />
        </div>
        <div class="col-md-9">
          <OrganizationProfile organization={organization} canWrite={canWrite} onSaved={load} />
        </div>
      </div>

      <RepresentativeRoster
        organization={organization}
        canManageRepresentatives={canManageRepresentatives}
        onChanged={load}
      />
    </section>
  );
}
