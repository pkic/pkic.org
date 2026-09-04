import type { ComponentChildren } from "preact";
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
import { Badge } from "../../../ui/Badge";
import { type MenuItem } from "../../../ui/Menu";
import { RowActions } from "../../../ui/RowActions";
import { confirmAction } from "../../../components/ConfirmDialog";
import type { DataTableRowAction } from "../../../ui/DataTable";
import { portalEntityHref } from "../entity-links";
import { Link } from "wouter";
import { patchJson } from "../../../shared/api-client";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import { portalAvatarInitials } from "../shell/PortalNavigationShell";
import { portalSession } from "../state";
import { toast } from "../ui";
// `pk-mono` on the email line comes from Content.css, which ships in a lazy
// chunk rather than the entry stylesheet, so this module imports it.
import "../../../ui/Content.css";

/** The person's name links into user administration when the viewer may see it. */
function IdentityName({ userId, name }: { userId: string; name: string }) {
  if (!portalHasGlobalPermission(portalSession.value, "users:read")) return <strong>{name}</strong>;
  return (
    <Link href={`/users/${encodeURIComponent(userId)}`} class="pk-strong">
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
    return <span class="pk-muted">—</span>;
  }
  // The gap between the two badges is the cluster's, not a margin on the
  // first one, and each badge still says which role it is in words.
  return (
    <span class="pk-cluster">
      {identity.isPrimaryContact && <Badge tone="accent">Primary</Badge>}
      {identity.isSecondaryContact && <Badge tone="info">Secondary</Badge>}
    </span>
  );
}

function statusTone(identity: { state: string }): "ok" | "warn" | "danger" | "neutral" {
  if (identity.state === "active") return "ok";
  if (identity.state === "pending") return "warn";
  if (identity.state === "blocked") return "danger";
  return "neutral";
}

function statusLabel(identity: ActingIdentity): string {
  if (identity.state === "blocked") return "Blocked";
  if (identity.state === "ended") return "Ended";
  if (identity.state === "pending") return "Invitation pending";
  return "Active";
}

/**
 * The row's activation: a link into user administration, offered only when the
 * viewer can actually reach that page. `portalEntityHref` already applies the
 * `users:read` rule, so permission is decided in one place rather than here.
 */
function identityRowAction(userId: string, name: string): DataTableRowAction | undefined {
  const path = portalEntityHref("user", userId);
  if (!path) return undefined;
  return { label: `Open ${name}'s user account`, href: usePortalHashLocation.hrefs(path) };
}

function activeColumns(): Column<ActiveActingIdentity>[] {
  return [
    {
      header: "Name",
      cell: (identity) => (
        <div class="pk-cluster">
          <IdentityAvatar name={identity.name ?? identity.email} headshotUrl={identity.headshotUrl} />
          <div class="pk-stack pk-stack--tight">
            <IdentityName userId={identity.userId} name={identity.name ?? identity.email} />
            <div class="pk-mono pk-small">{identity.email}</div>
            {identity.jobTitle && <div class="pk-small">{identity.jobTitle}</div>}
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
  caption = "Organization identities",
  toolbar,
  inset,
  empty,
}: {
  organizationId: string;
  activeIdentities: ActiveActingIdentity[];
  canManage: boolean;
  canBlock?: (userId: string) => boolean;
  onChanged?: () => Promise<void>;
  actionsRef?: MutableRef<ApiTableActions | null>;
  /** The directory's create affordance, rendered in its own toolbar row alongside search and refresh. */
  createAction?: { label: string; onSelect: () => void };
  /** The list's name; the organization page calls it Representatives. */
  caption?: string;
  /** Extra commands for the list's toolbar, beside search and refresh. */
  toolbar?: ComponentChildren;
  /** A form the toolbar opened, drawn inside the list panel under its head. */
  inset?: ComponentChildren;
  /**
   * What an empty directory says.
   *
   * A surface that offers adding an identity from its own panel header —
   * rather than through `createAction` — knows the words for it and which
   * controls carry it out; this directory knows neither. Given one it renders
   * it, and otherwise falls back to naming the absence.
   */
  empty?: ComponentChildren;
}) {
  const localTableRef = useRef<ApiTableActions | null>(null);
  const tableRef = actionsRef ?? localTableRef;
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const activeByIdentityId = useMemo(
    () => new Map(activeIdentities.map((identity) => [identity.identityId, identity])),
    [activeIdentities],
  );

  if (!canManage) {
    return (
      // The same framed, named list a manager gets, without the commands: a
      // viewer's roster is still the page's Representatives region.
      <section class="pk pk-panel pk-table-list" aria-label={caption}>
        <DataTable
          caption={caption}
          columns={activeColumns()}
          data={activeIdentities}
          empty={empty ?? "No representatives yet"}
          rowKey={(identity) => identity.userId}
          rowAction={(identity) => identityRowAction(identity.userId, identity.name ?? identity.email)}
        />
      </section>
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
      caption={caption}
      /* A list on a record page says what it is a list of. Hidden, the roster
         opened with a search box and a table whose first column heading was
         the only clue. */
      showCaption
      toolbar={toolbar ? () => toolbar : undefined}
      inset={inset}
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
      rowAction={(identity) => identityRowAction(identity.userId, identity.userName)}
      columns={[
        {
          header: "Name",
          cell: (identity) => {
            const active = activeByIdentityId.get(identity.id);
            return (
              <div class="pk-cluster">
                <IdentityAvatar name={identity.userName} headshotUrl={identity.headshotUrl} />
                <div class="pk-stack pk-stack--tight">
                  <IdentityName userId={identity.userId} name={identity.userName} />
                  <div class="pk-mono pk-small">{identity.email}</div>
                  {active?.jobTitle && <div class="pk-small">{active.jobTitle}</div>}
                </div>
              </div>
            );
          },
          sort: { asc: "user_name", desc: "-user_name" },
        },
        {
          header: "Status",
          // A state is a badge, and a badge does not wrap: "Invitation
          // pending" broke across two lines as plain text in a narrow column.
          cell: (identity) => <Badge tone={statusTone(identity)}>{statusLabel(identity)}</Badge>,
          width: "fit",
          sort: { asc: "updated_at", desc: "-updated_at", defaultDirection: "desc" },
        },
        {
          header: "Contact role",
          cell: (identity) => <ContactRole identity={activeByIdentityId.get(identity.id)} />,
          width: "fit",
        },
        {
          header: "On profile",
          width: "fit",
          cell: (identity) =>
            statusLabel(identity) === "Active" ? (
              <span>{identity.showOnOrganizationProfile ? "Shown on profile" : "Hidden"}</span>
            ) : (
              <span class="pk-muted">—</span>
            ),
        },
        {
          // A blank `th` is announced as an unnamed column; this one holds the
          // per-row action menu, so it says so.
          header: "Actions",
          className: "pk-end",
          cell: (identity) => {
            const actions = rowActions(identity);
            if (actions.length === 0) return null;
            return <RowActions subject={identity.userName} actions={actions} />;
          },
        },
      ]}
      empty={
        empty ??
        (createAction ? (
          // The same `createAction` is already the toolbar's button, so this
          // state names it rather than rendering it a second time under the
          // same accessible name.
          <EmptyState title="No representatives yet" body={`Use ${createAction.label} above to get started.`} />
        ) : (
          "No identities"
        ))
      }
      rowKey={(identity) => identity.id}
    />
  );
}
