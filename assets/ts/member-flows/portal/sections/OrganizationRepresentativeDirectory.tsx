import { useMemo, useRef, useState, type MutableRef } from "preact/hooks";
import {
  organizationRepresentativesListResponseSchema,
  representativeMutationResponseSchema,
  type OrganizationRepresentative,
} from "../../../../shared/schemas/organization-representation";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { DataTable, type Column } from "../../../components/Table";
import { Link } from "wouter";
import { deleteJson, patchJson, postJson } from "../../../shared/api-client";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import { portalSession } from "../state";
import { toast } from "../ui";

/** The person's name links into user administration when the viewer may see it. */
function RepresentativeName({ userId, name }: { userId: string; name: string }) {
  if (!portalHasGlobalPermission(portalSession.value, "users:read")) return <strong>{name}</strong>;
  return (
    <Link href={`/users/${encodeURIComponent(userId)}`} class="fw-bold">
      {name}
    </Link>
  );
}

export interface ActiveOrganizationRepresentative {
  userId: string;
  name: string | null;
  email: string;
  jobTitle?: string | null;
  showOnOrgProfile: boolean;
  isPrimaryContact: boolean;
  isSecondaryContact: boolean;
}

function ContactRole({ representative }: { representative?: ActiveOrganizationRepresentative }) {
  if (!representative?.isPrimaryContact && !representative?.isSecondaryContact) {
    return <span class="text-muted">—</span>;
  }
  return (
    <>
      {representative.isPrimaryContact && <span class="badge text-bg-primary me-1">Primary</span>}
      {representative.isSecondaryContact && <span class="badge text-bg-info">Secondary</span>}
    </>
  );
}

function statusLabel(representative: OrganizationRepresentative): "Active" | "Blocked" | "Inactive" {
  if (representative.blockedAt) return "Blocked";
  return representative.leftAt ? "Inactive" : "Active";
}

function statusBadge(representative: OrganizationRepresentative) {
  const status = statusLabel(representative);
  const color = status === "Active" ? "success" : status === "Blocked" ? "danger" : "secondary";
  return <span class={`badge text-bg-${color}`}>{status}</span>;
}

function activeColumns(): Column<ActiveOrganizationRepresentative>[] {
  return [
    {
      header: "Name",
      cell: (representative) => (
        <>
          <RepresentativeName userId={representative.userId} name={representative.name ?? representative.email} />
          <div class="mono text-muted small">{representative.email}</div>
          {representative.jobTitle && <div class="small text-muted">{representative.jobTitle}</div>}
        </>
      ),
    },
    { header: "Status", cell: () => <span class="badge text-bg-success">Active</span> },
    { header: "Contact role", cell: (representative) => <ContactRole representative={representative} /> },
  ];
}

/**
 * Canonical organization-representative roster. Managers use the bounded D1
 * collection so blocked relationships remain visible and explicitly
 * restorable; read-only viewers receive the active projection already present
 * in their parent response without a second request.
 */
export function OrganizationRepresentativeDirectory({
  organizationId,
  activeRepresentatives,
  canManage,
  canBlock = () => true,
  onChanged,
  actionsRef,
}: {
  organizationId: string;
  activeRepresentatives: ActiveOrganizationRepresentative[];
  canManage: boolean;
  canBlock?: (userId: string) => boolean;
  onChanged?: () => Promise<void>;
  actionsRef?: MutableRef<ApiTableActions | null>;
}) {
  const localTableRef = useRef<ApiTableActions | null>(null);
  const tableRef = actionsRef ?? localTableRef;
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const activeByUserId = useMemo(
    () => new Map(activeRepresentatives.map((representative) => [representative.userId, representative])),
    [activeRepresentatives],
  );

  if (!canManage) {
    return (
      <DataTable
        columns={activeColumns()}
        data={activeRepresentatives}
        empty="No representatives"
        rowKey={(representative) => representative.userId}
      />
    );
  }

  async function refresh() {
    await tableRef.current?.reload();
    await onChanged?.();
  }

  async function updateVisibility(representative: OrganizationRepresentative, showOnOrganizationProfile: boolean) {
    setBusyUserId(representative.userId);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives/${encodeURIComponent(representative.userId)}`,
        { showOnOrganizationProfile },
        representativeMutationResponseSchema,
      );
      toast("Representative visibility updated", "success");
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  async function block(representative: OrganizationRepresentative) {
    if (
      !confirm(
        `Block ${representative.userName} as an organization representative? They will immediately lose organization-derived access. Their user account is not deleted, and they can be explicitly restored later.`,
      )
    ) {
      return;
    }
    setBusyUserId(representative.userId);
    try {
      await deleteJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives/${encodeURIComponent(representative.userId)}`,
        successResponseSchema,
      );
      toast("Representative blocked", "success");
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  async function restore(representative: OrganizationRepresentative) {
    if (!confirm(`Restore ${representative.userName} as an active organization representative?`)) return;
    setBusyUserId(representative.userId);
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives/${encodeURIComponent(representative.userId)}/restore`,
        {},
        successResponseSchema,
      );
      toast("Representative restored", "success");
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <ApiDataTable
      endpoint={`/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives`}
      responseSchema={organizationRepresentativesListResponseSchema}
      resolve={(response) => response.representatives}
      resolvePage={(response) => response.page}
      paginate
      initialPageSize={25}
      initialSort="user_name"
      searchPlaceholder="name or email"
      actionsRef={tableRef}
      columns={[
        {
          header: "Name",
          cell: (representative) => {
            const active = activeByUserId.get(representative.userId);
            return (
              <>
                <RepresentativeName userId={representative.userId} name={representative.userName} />
                <div class="mono text-muted small">{representative.email}</div>
                {active?.jobTitle && <div class="small text-muted">{active.jobTitle}</div>}
              </>
            );
          },
          sort: { asc: "user_name", desc: "-user_name" },
        },
        {
          header: "Status",
          cell: statusBadge,
          sort: { asc: "updated_at", desc: "-updated_at", defaultDirection: "desc" },
        },
        {
          header: "Contact role",
          cell: (representative) => <ContactRole representative={activeByUserId.get(representative.userId)} />,
        },
        {
          header: { label: "On profile", className: "text-center" },
          className: "text-center",
          cell: (representative) =>
            statusLabel(representative) === "Active" ? (
              <input
                aria-label={`Show ${representative.userName} on organization profile`}
                type="checkbox"
                class="form-check-input"
                checked={representative.showOnOrganizationProfile}
                disabled={busyUserId === representative.userId}
                onChange={(event) => void updateVisibility(representative, (event.target as HTMLInputElement).checked)}
              />
            ) : (
              <span class="text-muted">—</span>
            ),
        },
        {
          header: "",
          className: "text-end",
          cell: (representative) => {
            const status = statusLabel(representative);
            if (status === "Blocked") {
              return (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-success"
                  aria-label={`Restore ${representative.userName} as representative`}
                  disabled={busyUserId === representative.userId}
                  onClick={() => void restore(representative)}
                >
                  Restore
                </button>
              );
            }
            if (status !== "Active" || !canBlock(representative.userId)) return null;
            return (
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                aria-label={`Block ${representative.userName} as representative`}
                disabled={busyUserId === representative.userId}
                onClick={() => void block(representative)}
              >
                Block
              </button>
            );
          },
        },
      ]}
      empty="No representatives"
      rowKey={(representative) => representative.id}
    />
  );
}
