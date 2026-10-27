import { identityInvitationManagementSchema } from "../../../../shared/schemas/identity-invitation-management";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { ActivateIdentityInvitationDialog } from "../../../components/identities/ActivateIdentityInvitationDialog";
import { confirmAction } from "../../../components/ConfirmDialog";
import { portalSession } from "../state";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import type { ComponentChildren } from "preact";
import { useRef, useState, type MutableRef } from "preact/hooks";
import { usePortalHashLocation } from "../hash-location";
import {
  identitiesListResponseSchema,
  identityMutationResponseSchema,
  type ActingIdentity,
} from "../../../../shared/schemas/identity";
import { ApiDataTable, type ApiTableActions, type ApiDataTableProps } from "../../../components/ApiDataTable";
import { DataTable, type Column } from "../../../components/Table";
import { EmptyState } from "../../../ui/EmptyState";
import { Badge } from "../../../ui/Badge";
import { type MenuItem } from "../../../ui/Menu";
import { RowActions } from "../../../ui/RowActions";
import { ReinstateRepresentationDialog } from "../../../components/identities/ReinstateRepresentationDialog";
import { EndRepresentationDialog } from "../../../components/identities/EndRepresentationDialog";
import type { DataTableRowAction } from "../../../ui/DataTable";
import { portalEntityHref } from "../entity-links";
import { patchJson, postJson } from "../../../shared/api-client";
import { PersonCellPreview } from "../../../components/identities/PersonCellPreview";
import { toast } from "../ui";
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
        <PersonCellPreview
          name={identity.name ?? identity.email}
          title={identity.jobTitle}
          avatarSrc={identity.headshotUrl}
          profilePath={identityRowAction(identity.userId, identity.name ?? identity.email)?.href}
          size="sm"
        />
      ),
    },
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
  showCaption = true,
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
  createAction?: ApiDataTableProps<ActingIdentity, unknown>["createAction"];
  /** The list's name; the organization page calls it Representatives. */
  caption?: string;
  showCaption?: boolean;
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
  const [activating, setActivating] = useState<ActingIdentity | null>(null);
  const [ending, setEnding] = useState<ActingIdentity | null>(null);
  const [reinstating, setReinstating] = useState<ActingIdentity | null>(null);

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

  async function endIdentity(identity: ActingIdentity, endedAt: string | undefined) {
    await patchJson(
      `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities/${encodeURIComponent(identity.id)}`,
      {
        transition: {
          state: "ended",
          reason: "Ended from the organization identity directory",
          ...(endedAt ? { endedAt } : {}),
        },
      },
      identityMutationResponseSchema,
    );
    toast("Representation ended", "success");
    await refresh();
  }

  async function reinstateIdentity(identity: ActingIdentity) {
    await patchJson(
      `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities/${encodeURIComponent(identity.id)}`,
      { transition: { state: "active", reason: "Reinstated from the organization identity directory" } },
      identityMutationResponseSchema,
    );
    toast("Representation reinstated", "success");
    await refresh();
  }

  async function cancelInvitation(identity: ActingIdentity) {
    if (
      !(await confirmAction({
        title: "Cancel invitation?",
        body: `Remove the pending representation for ${identity.userName}. Their account and other representations stay available.`,
        confirmLabel: "Cancel invitation",
        tone: "danger",
      }))
    )
      return;
    setBusyUserId(identity.id);
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities/${encodeURIComponent(identity.id)}/invitation`,
        identityInvitationManagementSchema.parse({ action: "cancel", userId: identity.userId }),
        successResponseSchema,
      );
      toast("Invitation cancelled", "success");
      await refresh();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Could not cancel the invitation.", "error");
    } finally {
      setBusyUserId(null);
    }
  }

  function rowActions(identity: ActingIdentity): MenuItem[] {
    const status = statusLabel(identity);
    const busy = busyUserId === identity.id;
    if (identity.state === "ended" && canBlock(identity.userId)) {
      return [{ id: "reinstate", label: "Reinstate representation…", onSelect: () => setReinstating(identity) }];
    }
    if (identity.state === "pending") {
      if (!canBlock(identity.userId)) return [];
      const actions: MenuItem[] = [];
      if (
        portalHasGlobalPermission(portalSession.value, "membership:write") &&
        portalHasGlobalPermission(portalSession.value, "identities:activate")
      )
        actions.push({
          id: "activate",
          label: "Activate representation…",
          disabled: busy,
          onSelect: () => setActivating(identity),
        });
      actions.push({
        id: "cancel",
        label: "Cancel invitation…",
        danger: true,
        disabled: busy,
        onSelect: () => void cancelInvitation(identity),
      });
      return actions;
    }
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
        label: "End representation…",
        danger: true,
        disabled: busy,
        onSelect: () => setEnding(identity),
      });
    }
    return actions;
  }

  return (
    <>
      {activating && (
        <ActivateIdentityInvitationDialog
          organizationId={organizationId}
          identityId={activating.id}
          userId={activating.userId}
          name={activating.userName}
          onChanged={refresh}
          onClose={() => setActivating(null)}
        />
      )}
      {reinstating && (
        <ReinstateRepresentationDialog
          organizationName="this organization"
          subjectName={reinstating.userName}
          emailAddress={reinstating.email}
          onReinstate={() => reinstateIdentity(reinstating)}
          onClose={() => setReinstating(null)}
        />
      )}
      {ending && (
        <EndRepresentationDialog
          organizationName="this organization"
          subjectName={ending.userName}
          startedAt={ending.startedAt}
          onEnd={(endedAt) => endIdentity(ending, endedAt)}
          onClose={() => setEnding(null)}
        />
      )}
      <ApiDataTable
        urlState="organization-identities"
        caption={caption}
        showCaption={showCaption}
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
              return (
                <PersonCellPreview
                  name={identity.userName}
                  title={identity.jobTitle}
                  avatarSrc={identity.headshotUrl}
                  profilePath={identityRowAction(identity.userId, identity.userName)?.href}
                  size="sm"
                />
              );
            },
            sort: { asc: "user_name", desc: "-user_name" },
          },
          {
            header: "Status",
            cell: (identity) =>
              identity.state === "active" ? (
                <span>{statusLabel(identity)}</span>
              ) : (
                <Badge tone={statusTone(identity)}>{statusLabel(identity)}</Badge>
              ),
            width: "fit",
            sort: { asc: "updated_at", desc: "-updated_at", defaultDirection: "desc" },
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
            // The table adapter gives this action column its accessible name
            // and places the menu in the record's corner on narrow screens.
            header: "",
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
    </>
  );
}
