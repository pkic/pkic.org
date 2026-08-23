/**
 * Admin → Organizations. Manages an organization's public profile
 * (description, content, logo, socials, blog/press/careers) and its
 * representative roster once the organization exists — whether it was
 * created here, via Step 2 migration, or via application approval.
 * New organizations are still created via the same Interim
 * Admin Tool flow (`POST /api/v1/admin/members`); this section manages
 * them afterward.
 *
 * Split into feature components (PR #1 review) — see AddOrganizationForm,
 * Representatives, OrganizationProfileForm, OrganizationLogo, and
 * OrganizationDetailView in this directory. This file is just the
 * organization list + top-level create/detail composition.
 */
import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../components/ApiDataTable";
import { fmt } from "../../ui";
import { AddOrganizationForm } from "./AddOrganizationForm";
import { OrganizationDetailView } from "./OrganizationDetailView";
import { adminOrganizationsListResponseSchema } from "../../../../shared/schemas/admin-organizations";

export function Organizations() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const tableRef = useRef<ApiTableActions | null>(null);

  if (selectedOrgId) {
    return <OrganizationDetailView organizationId={selectedOrgId} onBack={() => setSelectedOrgId(null)} />;
  }

  return (
    <div>
      <div class="mb-3">
        <button class="btn btn-sm btn-success" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add organization"}
        </button>
      </div>

      {showAddForm && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">Add organization or individual member</div>
          <div class="card-body">
            <AddOrganizationForm
              onCreated={() => {
                setShowAddForm(false);
                tableRef.current?.reload();
              }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        </div>
      )}

      <ApiDataTable
        endpoint="/api/v1/admin/organizations"
        responseSchema={adminOrganizationsListResponseSchema}
        resolve={(data) => data.organizations}
        resolvePage={(data) => data.page}
        paginate
        actionsRef={tableRef}
        searchPlaceholder="organization name"
        columns={[
          {
            header: "Name",
            cell: (o) => (
              <>
                <strong class="adm-cell-name">{o.name}</strong>
                {o.slogan && (
                  <>
                    <br />
                    <span class="text-muted small">{o.slogan}</span>
                  </>
                )}
              </>
            ),
            sort: { asc: "name", desc: "-name" },
          },
          {
            header: "Category",
            cell: (o) =>
              o.membershipCategory ? (
                <span class="badge text-bg-success mono">{o.membershipCategory}</span>
              ) : (
                <span class="text-danger fst-italic">Not set</span>
              ),
            sort: { asc: "membership_category", desc: "-membership_category" },
          },
          {
            header: "Primary contact",
            cell: (o) =>
              o.primaryContactName ? (
                <>
                  {o.primaryContactName}
                  <br />
                  <span class="mono text-muted small">{o.primaryContactEmail}</span>
                </>
              ) : (
                <span class="text-muted fst-italic">None</span>
              ),
          },
          {
            header: "Representatives",
            cell: (o) => o.memberCount,
            className: "text-center",
            sort: { asc: "member_count", desc: "-member_count" },
          },
          {
            header: "Website",
            cell: (o) =>
              o.website ? (
                <a href={o.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {o.website.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                "—"
              ),
            className: "small",
          },
          {
            header: "Created",
            cell: (o) => fmt(o.createdAt),
            className: "mono small text-nowrap",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
        ]}
        empty="No organizations found"
        rowKey={(o) => o.id}
        rowClass={() => "adm-user-row"}
        onRowClick={(o) => setSelectedOrgId(o.id)}
      />
    </div>
  );
}
