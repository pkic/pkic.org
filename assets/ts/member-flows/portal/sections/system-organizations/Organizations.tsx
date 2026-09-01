import { useEffect } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../components/EmptyState";
import type { Column } from "../../../../components/Table";
import { Badge } from "../../../../ui/Badge";
import {
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../../shared/schemas/organization-management";
import { fmtDate } from "../../ui";
import { OrganizationCreateForm } from "./OrganizationCreateForm";
// `pk-mono` is defined in Content.css, which rides a lazy chunk: a surface
// that writes the class name has to pull the stylesheet in itself.
import "../../../../ui/Content.css";

/** Reserved organization-id segment that routes to the creation page instead of a record's detail. */
const NEW_ORGANIZATION_SEGMENT = "new";

const ORGANIZATIONS_PATH = "/organizations";

/** Redirects back to the directory from an effect, not render — see its call site below. */
function OrganizationsRedirect({ navigate }: { navigate: (path: string) => void }) {
  useEffect(() => navigate(ORGANIZATIONS_PATH), [navigate]);
  return null;
}

/**
 * Portal route adapter for the organization directory: the list, and — under
 * the reserved `new` segment — the create page, which is a place with its own
 * address rather than a panel that unfolds above the table.
 */
export function Organizations({
  canRead,
  canCreate,
  organizationSegment,
}: {
  canRead: boolean;
  canCreate: boolean;
  /** `undefined` for the directory, `"new"` for the create page. */
  organizationSegment?: string;
}) {
  const [, navigate] = usePortalHashLocation();

  function openCreatePage(): void {
    navigate(`${ORGANIZATIONS_PATH}/${NEW_ORGANIZATION_SEGMENT}`);
  }

  if (organizationSegment === NEW_ORGANIZATION_SEGMENT) {
    // Navigating away belongs in an effect, not in render.
    if (!canCreate) return <OrganizationsRedirect navigate={navigate} />;
    // The create page supplies its own `pk` root, its heading, and its way
    // back, so nothing is wrapped around it here.
    return (
      <OrganizationCreateForm
        onCreated={(organizationId) => navigate(`${ORGANIZATIONS_PATH}/${encodeURIComponent(organizationId)}`)}
        onCancel={() => navigate(ORGANIZATIONS_PATH)}
      />
    );
  }

  if (!canRead) {
    // A membership writer without `organizations:read` has nothing to list,
    // but still has somewhere to go: the state names what is missing and
    // carries the one command the account holds.
    return canCreate ? (
      <section class="pk pk-stack">
        <EmptyState
          title="The organization directory is not visible to your account."
          body="You can still add an organization."
          action={{ label: "Add organization", onSelect: openCreatePage }}
        />
      </section>
    ) : null;
  }

  const columns: Column<OrganizationSummary>[] = [
    {
      header: "Name",
      cell: (organization) => (
        <>
          <strong>{organization.name}</strong>
          {organization.slogan && <div class="pk-small">{organization.slogan}</div>}
        </>
      ),
      sort: { asc: "name", desc: "-name" },
    },
    {
      header: "Category",
      /*
       * The category is a label, not a healthy status, so it takes the neutral
       * tone rather than the green this cell used to paint every value. An
       * absent one reads as absent in words — "Not set" — instead of resting
       * on red text nobody can rely on seeing.
       */
      cell: (organization) =>
        organization.membershipCategory ? (
          <Badge tone="neutral" dot={false}>
            {organization.membershipCategory}
          </Badge>
        ) : (
          <em class="pk-muted">Not set</em>
        ),
      sort: { asc: "membership_category", desc: "-membership_category" },
    },
    {
      header: "Primary contact",
      cell: (organization) =>
        organization.primaryContactName ? (
          <>
            {organization.primaryContactName}
            <div class="pk-mono pk-muted pk-small">{organization.primaryContactEmail}</div>
          </>
        ) : (
          <em class="pk-muted">None</em>
        ),
    },
    {
      header: "Active identities",
      cell: (organization) => organization.activeIdentityCount,
      className: "pk-center",
      sort: { asc: "identity_count", desc: "-identity_count" },
    },
    {
      header: "Website",
      cell: (organization) =>
        organization.website ? (
          <a href={organization.website} target="_blank" rel="noreferrer">
            {organization.website.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          "—"
        ),
      className: "pk-small",
    },
    {
      header: "Created",
      cell: (organization) => fmtDate(organization.createdAt),
      className: "pk-mono pk-small pk-nowrap",
      sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
    },
  ];

  return (
    <section class="pk pk-stack">
      <ApiDataTable
        caption="Organizations"
        urlState="organizations"
        endpoint="/api/v1/organizations"
        responseSchema={organizationsListResponseSchema}
        resolve={(data) => data.organizations}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="organization name"
        createAction={canCreate ? { label: "Add organization", onSelect: openCreatePage } : undefined}
        columns={columns}
        empty={
          canCreate ? (
            <EmptyState title="No organizations yet" body="Add an organization to get started." />
          ) : (
            "No organizations found"
          )
        }
        rowKey={(organization) => organization.id}
        rowAction={(organization) => ({
          label: `Open ${organization.name}`,
          href: usePortalHashLocation.hrefs(`/organizations/${encodeURIComponent(organization.id)}`),
        })}
      />
    </section>
  );
}
