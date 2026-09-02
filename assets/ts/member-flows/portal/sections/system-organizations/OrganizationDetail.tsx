/**
 * One organization's record, read like an account page in a CRM.
 *
 * The page opens with one statement of what it is — `PageHeader` carries the
 * trail, the name, and the qualifying badges — and then shows the account:
 * its profile, the people who represent it, and its sponsorships, with the
 * mark and the contacts beside them. Nothing is behind a tab: a reader who
 * opens an organization wants to see who is there, and a facet that costs
 * one bounded query each does not need a click to earn it. The version this
 * replaces split the same three lists into tabs and made "who represents
 * this organization" a second step.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import {
  organizationDetailResponseSchema,
  type OrganizationDetail as OrganizationDetailModel,
} from "../../../../../shared/schemas/organization-management";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { getJson } from "../../../../shared/api-client";
import { Badge } from "../../../../ui/Badge";
import { PageHeader } from "../../../../ui/PageHeader";
import { OrganizationLogo } from "./OrganizationLogo";
import { OrganizationContacts, OrganizationProfile } from "./OrganizationProfile";
import { OrganizationSponsorships } from "./OrganizationSponsorships";
import { IdentityRoster } from "./IdentityRoster";
// `pk-mono` on the category code comes from Content.css, which ships in a lazy
// chunk rather than the entry stylesheet, so this module pulls it in itself.
import "../../../../ui/Content.css";

export function OrganizationDetail({
  organizationId,
  canRead,
  canWrite,
  canManageIdentities,
  canReadSponsorships,
}: {
  organizationId: string;
  canRead: boolean;
  canWrite: boolean;
  canManageIdentities: boolean;
  canReadSponsorships: boolean;
}) {
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

  const count = organization.activeIdentityCount;

  return (
    <section class="pk pk-stack" aria-label={organization.name}>
      <PageHeader
        trail={[
          { label: "Organizations", href: usePortalHashLocation.hrefs("/organizations") },
          { label: organization.name },
        ]}
        title={organization.name}
        context={
          <>
            {organization.membershipCategory && (
              <Badge tone="neutral" dot={false}>
                Category <span class="pk-mono">{organization.membershipCategory}</span>
              </Badge>
            )}
            {/* Reads as a sentence rather than as a bare number. */}
            <Badge tone={count > 0 ? "ok" : "warn"}>
              {count} active {count === 1 ? "representative" : "representatives"}
            </Badge>
          </>
        }
      />

      <div class="pk-record">
        <div class="pk-stack">
          <OrganizationProfile organization={organization} canWrite={canWrite} onSaved={load} />
          <IdentityRoster organization={organization} canManageIdentities={canManageIdentities} onChanged={load} />
          {canReadSponsorships && <OrganizationSponsorships organizationId={organization.id} />}
        </div>
        <div class="pk-stack">
          <OrganizationLogo organization={organization} canWrite={canWrite} onChanged={load} />
          <OrganizationContacts organization={organization} canEdit={canWrite} onSaved={load} />
        </div>
      </div>
    </section>
  );
}
