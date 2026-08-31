import { useRef, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../components/EmptyState";
import type { Column } from "../../../../components/Table";
import {
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../../shared/schemas/organization-management";
import { fmt } from "../../ui";
import { OrganizationCreateForm } from "./OrganizationCreateForm";

export function Organizations({ canRead, canCreate }: { canRead: boolean; canCreate: boolean }) {
  const [, navigate] = usePortalHashLocation();
  const [showCreate, setShowCreate] = useState(false);
  const actionsRef = useRef<ApiTableActions | null>(null);

  if (!canRead) {
    return canCreate ? (
      <section>
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
          {organization.slogan && <div class="small text-muted">{organization.slogan}</div>}
        </>
      ),
      sort: { asc: "name", desc: "-name" },
    },
    {
      header: "Category",
      cell: (organization) =>
        organization.membershipCategory ? (
          <span class="badge text-bg-success mono">{organization.membershipCategory}</span>
        ) : (
          <span class="text-danger fst-italic">Not set</span>
        ),
      sort: { asc: "membership_category", desc: "-membership_category" },
    },
    {
      header: "Primary contact",
      cell: (organization) =>
        organization.primaryContactName ? (
          <>
            {organization.primaryContactName}
            <div class="mono text-muted small">{organization.primaryContactEmail}</div>
          </>
        ) : (
          <span class="text-muted fst-italic">None</span>
        ),
    },
    {
      header: "Active identities",
      cell: (organization) => organization.activeIdentityCount,
      className: "text-center",
      sort: { asc: "identity_count", desc: "-identity_count" },
    },
    {
      header: "Website",
      cell: (organization) =>
        organization.website ? (
          <a href={organization.website} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            {organization.website.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          "—"
        ),
      className: "small",
    },
    {
      header: "Created",
      cell: (organization) => fmt(organization.createdAt),
      className: "mono small text-nowrap",
      sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
    },
  ];

  return (
    <section>
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
            <EmptyState
              title="No organizations yet"
              body="Add an organization to get started."
              action={{ label: "Add organization", onSelect: () => setShowCreate(true) }}
            />
          ) : (
            "No organizations found"
          )
        }
        rowKey={(organization) => organization.id}
        rowClass={() => "adm-user-row"}
        onRowClick={(organization) => navigate(`/organizations/${encodeURIComponent(organization.id)}`)}
      />
    </section>
  );
}
