import { useCallback, useEffect, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import {
  organizationDetailResponseSchema,
  type OrganizationDetail as OrganizationDetailModel,
} from "../../../../../shared/schemas/organization-management";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { getJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { OrganizationLogo } from "./OrganizationLogo";
import { OrganizationProfile } from "./OrganizationProfile";
import { IdentityRoster } from "./IdentityRoster";

export function OrganizationDetail({
  organizationId,
  canRead,
  canWrite,
  canManageIdentities,
}: {
  organizationId: string;
  canRead: boolean;
  canWrite: boolean;
  canManageIdentities: boolean;
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
    <section class="pk pk-stack" aria-labelledby="organization-detail-heading">
      <div class="pk-cluster">
        <Button size="sm" onClick={() => navigate("/organizations")}>
          ← Back to organizations
        </Button>
        {/* The organization's name heads the record, so it is a real heading
            rather than a styled span, and the section is labelled by it. */}
        <h2 id="organization-detail-heading">{organization.name}</h2>
        <span class="pk-small">
          {organization.activeIdentityCount} active {organization.activeIdentityCount === 1 ? "identity" : "identities"}
        </span>
      </div>

      <div class="pk-grid pk-grid--roomy">
        <OrganizationLogo organization={organization} canWrite={canWrite} onChanged={load} />
        <OrganizationProfile organization={organization} canWrite={canWrite} onSaved={load} />
      </div>

      <IdentityRoster organization={organization} canManageIdentities={canManageIdentities} onChanged={load} />
    </section>
  );
}
