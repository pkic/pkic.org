import { useRef, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
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

export function Organizations({ canRead, canCreate }: { canRead: boolean; canCreate: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const actionsRef = useRef<ApiTableActions | null>(null);

  if (!canRead) {
    return canCreate ? (
      <section class="pk pk-stack">
        <OrganizationCreateForm onCreated={() => setShowCreate(false)} onCancel={() => setShowCreate(false)} />
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
      {showCreate && canCreate && (
        <OrganizationCreateForm
          onCreated={() => {
            setShowCreate(false);
            void actionsRef.current?.reload();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <ApiDataTable
        caption="Organizations"
        urlState="organizations"
        endpoint="/api/v1/organizations"
        responseSchema={organizationsListResponseSchema}
        resolve={(data) => data.organizations}
        resolvePage={(data) => data.page}
        paginate
        actionsRef={actionsRef}
        searchPlaceholder="organization name"
        createAction={canCreate ? { label: "Add organization", onSelect: () => setShowCreate(true) } : undefined}
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
