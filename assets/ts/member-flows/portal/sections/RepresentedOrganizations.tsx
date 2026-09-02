/**
 * The organizations the current user actively represents, each linking into
 * its organization workspace. Staff with the directory permission see the
 * full catalog instead (Organizations); this view is the representative's
 * own slice of the same domain.
 */
import type { z } from "zod";
import { usePortalHashLocation } from "../hash-location";
import { userOrganizationsListResponseSchema } from "../../../../shared/schemas/user-organizations";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { Badge } from "../../../components/Badge";
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody } from "../../../ui/Panel";
import { useMembershipCategoryLabels } from "../../../hooks/useMembershipCategoryLabels";

type UserOrganization = z.infer<typeof userOrganizationsListResponseSchema>["organizations"][number];

export function RepresentedOrganizations() {
  const categories = useMembershipCategoryLabels();
  return (
    <div class="pk pk-stack">
      <PageHeader title="Your organizations" />
      <Panel>
        <PanelBody>
          <ApiDataTable
            caption="Your organizations"
            endpoint="/api/v1/users/current/organizations"
            responseSchema={userOrganizationsListResponseSchema}
            resolve={(response) => response.organizations}
            resolvePage={(response) => response.page}
            paginate
            initialSort="name"
            searchPlaceholder="Search your organizations…"
            columns={[
              {
                header: "Organization",
                cell: (organization: UserOrganization) => (
                  <div class="pk-stack pk-stack--tight">
                    <div class="pk-strong">{organization.name}</div>
                    {organization.membershipCategory && (
                      <div class="pk-small">{categories.label(organization.membershipCategory)}</div>
                    )}
                  </div>
                ),
                sort: { asc: "name", desc: "-name", defaultDirection: "asc" },
              },
              {
                header: "Your role",
                cell: (organization: UserOrganization) =>
                  organization.isPrimaryContact ? (
                    <Badge status="active" label="Primary contact" />
                  ) : organization.isOrgContact ? (
                    <Badge status="active" label="Contact" />
                  ) : (
                    <span class="pk-small">Representative</span>
                  ),
              },
              {
                // A blank `th` is announced as an unnamed column. The badge in
                // it is about the organization's pending content review, so the
                // column says so.
                header: "Review",
                className: "pk-end",
                cell: (organization: UserOrganization) =>
                  organization.hasPendingReview ? <Badge status="pending" label="Review pending" /> : null,
              },
            ]}
            empty="You do not represent any organizations right now."
            rowKey={(organization: UserOrganization) => organization.organizationId}
            rowAction={(organization: UserOrganization) => ({
              label: `Open ${organization.name}`,
              href: usePortalHashLocation.hrefs(`/organizations/${encodeURIComponent(organization.organizationId)}`),
            })}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
