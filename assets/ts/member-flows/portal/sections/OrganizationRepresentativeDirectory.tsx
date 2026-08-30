import { useMemo, useRef, useState, type MutableRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import {
  organizationRepresentativesListResponseSchema,
  representativeMutationResponseSchema,
  type OrganizationRepresentative,
} from "../../../../shared/schemas/organization-representation";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { DataTable, type Column } from "../../../components/Table";
import { EmptyState } from "../../../components/EmptyState";
import { type MenuAction } from "../../../components/Menu";
import { RowActions } from "../../../components/RowActions";
import { confirmAction } from "../../../components/ConfirmDialog";
import { Link } from "wouter";
import { deleteJson, patchJson, postJson } from "../../../shared/api-client";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import { portalAvatarInitials } from "../shell/PortalNavigationShell";
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

/** Small round headshot, falling back to initials — reuses the account-menu avatar treatment. */
function RepresentativeAvatar({ name, headshotUrl }: { name: string; headshotUrl?: string | null }) {
  return (
    <span class="portal-user-avatar portal-user-avatar--table" aria-hidden="true">
      {headshotUrl ? <img src={headshotUrl} alt="" /> : portalAvatarInitials(name)}
    </span>
  );
}

export interface ActiveOrganizationRepresentative {
  userId: string;
  name: string | null;
  email: string;
  headshotUrl?: string | null;
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

type RepresentativeStatus = "Active" | "Removed — blocked from re-adding" | "Inactive";

function statusLabel(representative: OrganizationRepresentative): RepresentativeStatus {
  if (representative.blockedAt) return "Removed — blocked from re-adding";
  return representative.leftAt ? "Inactive" : "Active";
}

/** Navigates rows into user administration only when the viewer can actually see that page. */
function useRepresentativeRowNavigation() {
  const [, navigate] = useHashLocation();
  const canNavigate = portalHasGlobalPermission(portalSession.value, "users:read");
  return canNavigate ? (userId: string) => navigate(`/users/${encodeURIComponent(userId)}`) : undefined;
}

function activeColumns(): Column<ActiveOrganizationRepresentative>[] {
  return [
    {
      header: "Name",
      cell: (representative) => (
        <div class="d-flex align-items-center gap-2">
          <RepresentativeAvatar
            name={representative.name ?? representative.email}
            headshotUrl={representative.headshotUrl}
          />
          <div>
            <RepresentativeName userId={representative.userId} name={representative.name ?? representative.email} />
            <div class="mono text-muted small">{representative.email}</div>
            {representative.jobTitle && <div class="small text-muted">{representative.jobTitle}</div>}
          </div>
        </div>
      ),
    },
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
  createAction,
}: {
  organizationId: string;
  activeRepresentatives: ActiveOrganizationRepresentative[];
  canManage: boolean;
  canBlock?: (userId: string) => boolean;
  onChanged?: () => Promise<void>;
  actionsRef?: MutableRef<ApiTableActions | null>;
  /** The directory's create affordance, rendered in its own toolbar row alongside search and refresh. */
  createAction?: { label: string; onSelect: () => void };
}) {
  const localTableRef = useRef<ApiTableActions | null>(null);
  const tableRef = actionsRef ?? localTableRef;
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const onRowNavigate = useRepresentativeRowNavigation();
  const activeByUserId = useMemo(
    () => new Map(activeRepresentatives.map((representative) => [representative.userId, representative])),
    [activeRepresentatives],
  );

  if (!canManage) {
    return (
      <DataTable
        columns={activeColumns()}
        data={activeRepresentatives}
        empty="No representatives yet"
        rowKey={(representative) => representative.userId}
        onRowClick={onRowNavigate ? (representative) => onRowNavigate(representative.userId) : undefined}
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

  async function removeFromOrganization(representative: OrganizationRepresentative) {
    const confirmed = await confirmAction({
      title: `Remove ${representative.userName} from this organization?`,
      body: "This ends their representation of this organization and its group capacities.",
      consequences: [
        "The representative record is removed; their user account is kept",
        "They lose this organization's member access",
        "Re-adding them is blocked until you restore the record",
      ],
      confirmLabel: "Remove from organization",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusyUserId(representative.userId);
    try {
      await deleteJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/representatives/${encodeURIComponent(representative.userId)}`,
        successResponseSchema,
      );
      toast("Representative removed", "success");
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  async function restore(representative: OrganizationRepresentative) {
    const confirmed = await confirmAction({
      title: `Restore ${representative.userName} as an active organization representative?`,
      consequences: ["They regain this organization's member access and appear as an active representative"],
      confirmLabel: "Restore representative",
      tone: "primary",
    });
    if (!confirmed) return;
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

  function rowActions(representative: OrganizationRepresentative): MenuAction[] {
    const status = statusLabel(representative);
    const busy = busyUserId === representative.userId;
    if (status === "Removed — blocked from re-adding") {
      return [{ key: "restore", label: "Restore", disabled: busy, onSelect: () => void restore(representative) }];
    }
    if (status !== "Active") return [];
    const actions: MenuAction[] = [
      {
        key: "toggle-visibility",
        label: representative.showOnOrganizationProfile ? "Hide from profile" : "Show on profile",
        disabled: busy,
        onSelect: () => void updateVisibility(representative, !representative.showOnOrganizationProfile),
      },
    ];
    if (canBlock(representative.userId)) {
      actions.push({
        key: "remove",
        label: "Remove from organization",
        disabled: busy,
        onSelect: () => void removeFromOrganization(representative),
      });
    }
    return actions;
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
      createAction={createAction}
      onRowClick={onRowNavigate ? (representative) => onRowNavigate(representative.userId) : undefined}
      columns={[
        {
          header: "Name",
          cell: (representative) => {
            const active = activeByUserId.get(representative.userId);
            return (
              <div class="d-flex align-items-center gap-2">
                <RepresentativeAvatar name={representative.userName} headshotUrl={representative.headshotUrl} />
                <div>
                  <RepresentativeName userId={representative.userId} name={representative.userName} />
                  <div class="mono text-muted small">{representative.email}</div>
                  {active?.jobTitle && <div class="small text-muted">{active.jobTitle}</div>}
                </div>
              </div>
            );
          },
          sort: { asc: "user_name", desc: "-user_name" },
        },
        {
          header: "Status",
          cell: (representative) => <span>{statusLabel(representative)}</span>,
          sort: { asc: "updated_at", desc: "-updated_at", defaultDirection: "desc" },
        },
        {
          header: "Contact role",
          cell: (representative) => <ContactRole representative={activeByUserId.get(representative.userId)} />,
        },
        {
          header: "On profile",
          cell: (representative) =>
            statusLabel(representative) === "Active" ? (
              <span>{representative.showOnOrganizationProfile ? "Shown on profile" : "Hidden"}</span>
            ) : (
              <span class="text-muted">—</span>
            ),
        },
        {
          header: "",
          className: "text-end",
          cell: (representative) => {
            const actions = rowActions(representative);
            if (actions.length === 0) return null;
            return <RowActions label={`Actions for ${representative.userName}`} actions={actions} />;
          },
        },
      ]}
      empty={
        createAction ? (
          <EmptyState
            title="No representatives yet"
            body="Add a representative to get started."
            action={createAction}
          />
        ) : (
          "No representatives"
        )
      }
      rowKey={(representative) => representative.id}
    />
  );
}
