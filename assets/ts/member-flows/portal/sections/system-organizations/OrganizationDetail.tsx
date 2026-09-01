/**
 * One organization's record.
 *
 * The page opens with one statement of what it is — `PageHeader` carries the
 * trail, the name, and the qualifying badges — and then splits its facets
 * into tabs. The version this replaces said "organization" three times before
 * any content (section title, breadcrumb, kicker) and stacked profile, logo,
 * contacts, and the roster into one scroll; the anatomy calls both defects
 * out by name.
 *
 * Each tab's panel mounts only while its tab is selected, so its bounded
 * query runs when the reader asks for that facet — a tab is precisely the
 * license not to fetch everything on first paint. Only the record itself
 * (the detail GET the header needs) loads with the page.
 */
import type { ComponentChildren } from "preact";
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
import { TabList } from "../../../../ui/TabList";
import { OrganizationLogo } from "./OrganizationLogo";
import { OrganizationContacts, OrganizationProfile } from "./OrganizationProfile";
import { OrganizationSponsorships } from "./OrganizationSponsorships";
import { IdentityRoster } from "./IdentityRoster";
// `pk-mono` on the category code comes from Content.css, which ships in a lazy
// chunk rather than the entry stylesheet, so this module pulls it in itself.
import "../../../../ui/Content.css";

type DetailTab = "overview" | "identities" | "sponsorships";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "Overview",
  identities: "Identities",
  sponsorships: "Sponsorships",
};

const TAB_ID_PREFIX = "organization-detail";

function panelIdFor(tab: DetailTab): string {
  return `${TAB_ID_PREFIX}-${tab}-panel`;
}

/** Names itself and points back at the tab that revealed it — the other half of `role="tab"`'s contract. */
function TabPanel({ tab, children }: { tab: DetailTab; children: ComponentChildren }) {
  return (
    <div id={panelIdFor(tab)} role="tabpanel" aria-labelledby={`${TAB_ID_PREFIX}-${tab}`}>
      {children}
    </div>
  );
}

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
  const [tab, setTab] = useState<DetailTab>("overview");

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
  const tabs: DetailTab[] = ["overview", "identities", ...(canReadSponsorships ? (["sponsorships"] as const) : [])];
  const activeTab = tabs.includes(tab) ? tab : "overview";

  /*
   * A viewer who may not edit and has no logo to look at has nothing to put in
   * the supporting column, and the grid would hold its empty track open beside
   * the profile — `pk-grid` uses `auto-fill` precisely so that a card keeps its
   * size whether or not it has neighbours. So the second column is only asked
   * for when something is going into it.
   */
  const hasSupport = canWrite || organization.logoUrl !== null;
  const profile = <OrganizationProfile organization={organization} canWrite={canWrite} onSaved={load} />;

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
            {/* Reads as a sentence rather than as a bare number, and the
                singular is not "1 identities". */}
            <Badge tone={count > 0 ? "ok" : "warn"}>
              {count} active {count === 1 ? "identity" : "identities"}
            </Badge>
          </>
        }
      />

      <TabList
        label={`${organization.name} sections`}
        idPrefix={TAB_ID_PREFIX}
        items={tabs.map((key) => ({ id: key, label: TAB_LABELS[key], panelId: panelIdFor(key) }))}
        activeId={activeTab}
        onSelect={(id) => setTab(id as DetailTab)}
      />

      {activeTab === "overview" && (
        <TabPanel tab="overview">
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
        </TabPanel>
      )}

      {activeTab === "identities" && (
        <TabPanel tab="identities">
          <IdentityRoster organization={organization} canManageIdentities={canManageIdentities} onChanged={load} />
        </TabPanel>
      )}

      {activeTab === "sponsorships" && canReadSponsorships && (
        <TabPanel tab="sponsorships">
          <OrganizationSponsorships organizationId={organization.id} />
        </TabPanel>
      )}
    </section>
  );
}
