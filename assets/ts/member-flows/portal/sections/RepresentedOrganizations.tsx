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

type UserOrganization = z.infer<typeof userOrganizationsListResponseSchema>["organizations"][number];

export function RepresentedOrganizations() {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Your organizations</div>
      <div class="card-body">
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
                <div>
                  <div class="fw-semibold">{organization.name}</div>
                  {organization.membershipCategory && (
                    <div class="small text-muted">Category {organization.membershipCategory}</div>
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
                  <span class="small text-muted">Representative</span>
                ),
            },
            {
              header: "",
              className: "text-end",
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
      </div>
    </div>
  );
}
