import { useState } from "preact/hooks";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import type { Column } from "../../../../components/Table";
import { Panel, PanelHeader } from "../../../../ui/Panel";
import { PersonCell } from "../../../../ui/PersonCell";
import { formatNumber } from "../../../../../shared/format-number";
import {
  organizationsListResponseSchema,
  type OrganizationSummary,
  type OrganizationDetail,
} from "../../../../../shared/schemas/organization-management";
import { usePortalHashLocation } from "../../hash-location";

const columns: Column<OrganizationSummary>[] = [
  {
    header: "Organization",
    width: "primary",
    sort: { asc: "name", desc: "-name" },
    cell: (organization) => (
      <PersonCell name={organization.name} avatarSrc={organization.logoUrl ?? undefined} shape="square" size="sm" />
    ),
  },
  {
    header: "Representatives",
    align: "end",
    width: "fit",
    sort: { asc: "identity_count", desc: "-identity_count" },
    cell: (organization) => formatNumber(organization.activeIdentityCount),
  },
];

/** Domain connections are derived from canonical claims and current proof, never asserted as corporate ownership. */
export function OrganizationRelated({ organization }: { organization: OrganizationDetail }) {
  const [empty, setEmpty] = useState(false);
  const [searching, setSearching] = useState(false);
  if (!organization.emailDomains.length && !organization.claimedDomains.length) return null;
  return (
    <div hidden={empty && !searching}>
      <Panel>
        <PanelHeader title="Email domain connections" />
        <ApiDataTable
          urlState="related-organizations"
          caption="Organizations connected by email domain"
          endpoint="/api/v1/organizations"
          params={{ relatedToOrganizationId: organization.id }}
          responseSchema={organizationsListResponseSchema}
          resolve={(data) => data.organizations}
          resolvePage={(data) => data.page}
          onData={(data) => setEmpty(data.page.total === 0)}
          onQueryChange={(query) => setSearching(Boolean(query.q))}
          columns={columns}
          rowKey={(organization) => organization.id}
          rowAction={(organization) => ({
            label: `Open ${organization.name}`,
            href: usePortalHashLocation.hrefs(`/organizations/${encodeURIComponent(organization.id)}`),
          })}
          paginate
          searchPlaceholder="organization name"
          empty="No organizations match your search."
        />
      </Panel>
    </div>
  );
}
