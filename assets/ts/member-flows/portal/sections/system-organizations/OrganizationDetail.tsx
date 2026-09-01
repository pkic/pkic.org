/**
 * One organization's record.
 *
 * The page had no subject. Its name, its identity count and the way back to
 * the list shared one line of small text above three panels of equal weight,
 * so nothing on the screen said what was being looked at or which part of it
 * mattered. The hierarchy is stated twice now — once in the outline and once
 * in the layout:
 *
 *   the heading    the organization's name, with its category and identity
 *                  count as badges beside it, over a trail back to the list
 *   the record     the profile's facts, in the wide column
 *   its support    the logo and the contacts, stacked in the narrow one
 *   its people     the identity roster, across the full width a table needs
 *
 * No new page-header block: the trail is `Breadcrumb`, the label is `Kicker`,
 * the qualifying facts are `Badge`, and the columns are the layout utilities
 * every other portal page composes.
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
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { Kicker } from "../../../../ui/Kicker";
import { OrganizationLogo } from "./OrganizationLogo";
import { OrganizationContacts, OrganizationProfile } from "./OrganizationProfile";
import { IdentityRoster } from "./IdentityRoster";
// `pk-mono` on the category code comes from Content.css, which ships in a lazy
// chunk rather than the entry stylesheet, so this module pulls it in itself.
import "../../../../ui/Content.css";

const HEADING_ID = "organization-detail-heading";

/** The record's name, and the two facts that qualify it. */
function OrganizationHeading({ organization }: { organization: OrganizationDetailModel }) {
  const count = organization.activeIdentityCount;

  return (
    <header class="pk-stack pk-stack--snug">
      <Breadcrumb
        items={[
          { label: "Organizations", href: usePortalHashLocation.hrefs("/organizations") },
          { label: organization.name },
        ]}
      />
      <div class="pk-cluster pk-cluster--between">
        <div class="pk-stack pk-stack--tight">
          <Kicker>Organization</Kicker>
          {/* The name is the page's subject, so it is a real heading and the
              record region is named by it. */}
          <h2 id={HEADING_ID}>{organization.name}</h2>
        </div>
        <div class="pk-cluster">
          {organization.membershipCategory && (
            <Badge tone="neutral" dot={false}>
              Category <span class="pk-mono">{organization.membershipCategory}</span>
            </Badge>
          )}
          {/* Reads as a sentence rather than as a bare number, and the
              singular is not "1 identities". */}
          <Badge tone={count > 0 ? "ok" : "warn"}>
            {count} active {count === 1 ? "identity" : "identities"}
          </Badge>
        </div>
      </div>
    </header>
  );
}

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

  const profile = <OrganizationProfile organization={organization} canWrite={canWrite} onSaved={load} />;
  /*
   * A viewer who may not edit and has no logo to look at has nothing to put in
   * the supporting column, and the grid would hold its empty track open beside
   * the profile — `pk-grid` uses `auto-fill` precisely so that a card keeps its
   * size whether or not it has neighbours. So the second column is only asked
   * for when something is going into it.
   */
  const hasSupport = canWrite || organization.logoUrl !== null;

  return (
    <section class="pk pk-stack" aria-labelledby={HEADING_ID}>
      <OrganizationHeading organization={organization} />

      {hasSupport ? (
        <div class="pk-grid pk-grid--roomy">
          {profile}
          <div class="pk-stack">
            <OrganizationLogo organization={organization} canWrite={canWrite} onChanged={load} />
            {canWrite && <OrganizationContacts organization={organization} onSaved={load} />}
          </div>
        </div>
      ) : (
        profile
      )}

      {/* The roster is the other half of the subject and it is a table, so it
          takes the whole measure rather than half of it. */}
      <IdentityRoster organization={organization} canManageIdentities={canManageIdentities} onChanged={load} />
    </section>
  );
}
