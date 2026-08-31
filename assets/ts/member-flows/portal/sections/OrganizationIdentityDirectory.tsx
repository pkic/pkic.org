import { useMemo, useRef, useState, type MutableRef } from "preact/hooks";
import { usePortalHashLocation } from "../hash-location";
import {
  identitiesListResponseSchema,
  identityMutationResponseSchema,
  type ActingIdentity,
} from "../../../../shared/schemas/identity";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { DataTable, type Column } from "../../../components/Table";
import { EmptyState } from "../../../components/EmptyState";
import { type MenuItem } from "../../../ui/Menu";
import { RowActions } from "../../../ui/RowActions";
import { confirmAction } from "../../../components/ConfirmDialog";
import { Link } from "wouter";
import { patchJson } from "../../../shared/api-client";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import { portalAvatarInitials } from "../shell/PortalNavigationShell";
import { portalSession } from "../state";
import { toast } from "../ui";

/** The person's name links into user administration when the viewer may see it. */
function IdentityName({ userId, name }: { userId: string; name: string }) {
  if (!portalHasGlobalPermission(portalSession.value, "users:read")) return <strong>{name}</strong>;
  return (
    <Link href={`/users/${encodeURIComponent(userId)}`} class="fw-bold">
      {name}
    </Link>
  );
}

/** Small round headshot, falling back to initials — reuses the account-menu avatar treatment. */
function IdentityAvatar({ name, headshotUrl }: { name: string; headshotUrl?: string | null }) {
  return (
    <span class="portal-user-avatar portal-user-avatar--table" aria-hidden="true">
      {headshotUrl ? <img src={headshotUrl} alt="" /> : portalAvatarInitials(name)}
    </span>
  );
}

export interface ActiveActingIdentity {
  identityId: string;
  userId: string;
  name: string | null;
  email: string;
  headshotUrl?: string | null;
  jobTitle?: string | null;
  showOnOrgProfile: boolean;
  isPrimaryContact: boolean;
  isSecondaryContact: boolean;
}

function ContactRole({ identity }: { identity?: ActiveActingIdentity }) {
  if (!identity?.isPrimaryContact && !identity?.isSecondaryContact) {
    return <span class="text-muted">—</span>;
  }
  return (
    <>
      {identity.isPrimaryContact && <span class="badge text-bg-primary me-1">Primary</span>}
      {identity.isSecondaryContact && <span class="badge text-bg-info">Secondary</span>}
    </>
  );
}

function statusLabel(identity: ActingIdentity): string {
  if (identity.state === "blocked") return "Blocked";
  if (identity.state === "ended") return "Ended";
  if (identity.state === "pending") return "Invitation pending";
  return "Active";
}

/** Navigates rows into user administration only when the viewer can actually see that page. */
function useIdentityRowNavigation() {
  const [, navigate] = usePortalHashLocation();
  const canNavigate = portalHasGlobalPermission(portalSession.value, "users:read");
  return canNavigate ? (userId: string) => navigate(`/users/${encodeURIComponent(userId)}`) : undefined;
}

function activeColumns(): Column<ActiveActingIdentity>[] {
  return [
    {
      header: "Name",
      cell: (identity) => (
        <div class="d-flex align-items-center gap-2">
          <IdentityAvatar name={identity.name ?? identity.email} headshotUrl={identity.headshotUrl} />
          <div>
            <IdentityName userId={identity.userId} name={identity.name ?? identity.email} />
            <div class="mono text-muted small">{identity.email}</div>
            {identity.jobTitle && <div class="small text-muted">{identity.jobTitle}</div>}
          </div>
        </div>
      ),
    },
    { header: "Contact role", cell: (identity) => <ContactRole identity={identity} /> },
  ];
}

/**
 * Canonical organization identity directory. Managers use the bounded D1
 * collection so ended and blocked identities remain visible; read-only viewers
 * receive the active projection already present
 * in their parent response without a second request.
 */
export function ActingIdentityDirectory({
  organizationId,
  activeIdentities,
  canManage,
  canBlock = () => true,
  onChanged,
  actionsRef,
  createAction,
}: {
  organizationId: string;
  activeIdentities: ActiveActingIdentity[];
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
  const onRowNavigate = useIdentityRowNavigation();
  const activeByIdentityId = useMemo(
    () => new Map(activeIdentities.map((identity) => [identity.identityId, identity])),
    [activeIdentities],
  );

  if (!canManage) {
    return (
      <DataTable
        columns={activeColumns()}
        data={activeIdentities}
        empty="No identities yet"
        rowKey={(identity) => identity.userId}
        onRowClick={onRowNavigate ? (identity) => onRowNavigate(identity.userId) : undefined}
      />
    );
  }

  async function refresh() {
    await tableRef.current?.reload();
    await onChanged?.();
  }

  async function updateVisibility(identity: ActingIdentity, showOnOrganizationProfile: boolean) {
    setBusyUserId(identity.id);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities/${encodeURIComponent(identity.id)}`,
        { profile: { showOnOrganizationProfile } },
        identityMutationResponseSchema,
      );
      toast("Identity visibility updated", "success");
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  async function endIdentity(identity: ActingIdentity) {
    const confirmed = await confirmAction({
      title: `End ${identity.userName}'s identity for this organization?`,
      body: "This ends this exact acting period without changing the user's account or other identities.",
      consequences: [
        "This identity and its group participation end",
        "They lose this organization's member access",
        "A later role period must be recorded as a new successor identity",
      ],
      confirmLabel: "End identity",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusyUserId(identity.id);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities/${encodeURIComponent(identity.id)}`,
        { transition: { state: "ended", reason: "Ended from the organization identity directory" } },
        identityMutationResponseSchema,
      );
      toast("Identity ended", "success");
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusyUserId(null);
    }
  }

  function rowActions(identity: ActingIdentity): MenuItem[] {
    const status = statusLabel(identity);
    const busy = busyUserId === identity.id;
    if (status !== "Active") return [];
    const actions: MenuItem[] = [
      {
        id: "toggle-visibility",
        label: identity.showOnOrganizationProfile ? "Hide from profile" : "Show on profile",
        disabled: busy,
        onSelect: () => void updateVisibility(identity, !identity.showOnOrganizationProfile),
      },
    ];
    if (canBlock(identity.userId)) {
      actions.push({
        id: "end",
        label: "End identity",
        disabled: busy,
        onSelect: () => void endIdentity(identity),
      });
    }
    return actions;
  }

  return (
    <ApiDataTable
      endpoint={`/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`}
      responseSchema={identitiesListResponseSchema}
      resolve={(response) => response.identities}
      resolvePage={(response) => response.page}
      paginate
      initialPageSize={25}
      initialSort="user_name"
      searchPlaceholder="name or email"
      actionsRef={tableRef}
      createAction={createAction}
      onRowClick={onRowNavigate ? (identity) => onRowNavigate(identity.userId) : undefined}
      columns={[
        {
          header: "Name",
          cell: (identity) => {
            const active = activeByIdentityId.get(identity.id);
            return (
              <div class="d-flex align-items-center gap-2">
                <IdentityAvatar name={identity.userName} headshotUrl={identity.headshotUrl} />
                <div>
                  <IdentityName userId={identity.userId} name={identity.userName} />
                  <div class="mono text-muted small">{identity.email}</div>
                  {active?.jobTitle && <div class="small text-muted">{active.jobTitle}</div>}
                </div>
              </div>
            );
          },
          sort: { asc: "user_name", desc: "-user_name" },
        },
        {
          header: "Status",
          cell: (identity) => <span>{statusLabel(identity)}</span>,
          sort: { asc: "updated_at", desc: "-updated_at", defaultDirection: "desc" },
        },
        {
          header: "Contact role",
          cell: (identity) => <ContactRole identity={activeByIdentityId.get(identity.id)} />,
        },
        {
          header: "On profile",
          cell: (identity) =>
            statusLabel(identity) === "Active" ? (
              <span>{identity.showOnOrganizationProfile ? "Shown on profile" : "Hidden"}</span>
            ) : (
              <span class="text-muted">—</span>
            ),
        },
        {
          header: "",
          className: "text-end",
          cell: (identity) => {
            const actions = rowActions(identity);
            if (actions.length === 0) return null;
            return <RowActions label={`Actions for ${identity.userName}`} actions={actions} />;
          },
        },
      ]}
      empty={
        createAction ? (
          <EmptyState title="No identities yet" body="Invite an identity to get started." action={createAction} />
        ) : (
          "No identities"
        )
      }
      rowKey={(identity) => identity.id}
    />
  );
}
