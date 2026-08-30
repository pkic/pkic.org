import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  EVENT_GROUP_CAPABILITIES,
  eventGroupGrantRouteSchemas,
  type EventGroupCapability,
  FORM_GROUP_CAPABILITIES,
  type FormGroupCapability,
  formPlacementGroupGrantRouteSchemas,
  MAILING_LIST_GROUP_CAPABILITIES,
  type MailingListGroupCapability,
  mailingListGroupGrantRouteSchemas,
  VOTE_GROUP_CAPABILITIES,
  type VoteGroupCapability,
  voteGroupGrantRouteSchemas,
} from "../../../../../shared/schemas/resource-grants";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import type { Group } from "../../../../../shared/schemas/groups";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { RowActions } from "../../../../components/RowActions";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { postJson, deleteJson } from "../../../../shared/api-client";
import { managedGroupCatalog } from "./catalog";

type ResourceSharingKind = "event" | "formPlacement" | "vote" | "mailingList";

type EventGrantResponse = z.infer<typeof eventGroupGrantRouteSchemas.listResponseSchema>;
type ResourceGrantCapability =
  EventGroupCapability | FormGroupCapability | VoteGroupCapability | MailingListGroupCapability;
type ResourceGrant = Omit<EventGrantResponse["grants"][number], "capability"> & {
  capability: ResourceGrantCapability;
};
type ResourceGrantListResponse = Omit<EventGrantResponse, "grants"> & { grants: ResourceGrant[] };

interface ResourceSharingConfig {
  path: string;
  capabilities: readonly string[];
  listResponseSchema: z.ZodType<ResourceGrantListResponse>;
  mutationResponseSchema: z.ZodType<unknown>;
}

const resourceSharingConfigs: Record<ResourceSharingKind, ResourceSharingConfig> = {
  event: {
    path: "events",
    capabilities: EVENT_GROUP_CAPABILITIES,
    listResponseSchema: eventGroupGrantRouteSchemas.listResponseSchema as z.ZodType<ResourceGrantListResponse>,
    mutationResponseSchema: eventGroupGrantRouteSchemas.mutationResponseSchema,
  },
  formPlacement: {
    path: "forms",
    capabilities: FORM_GROUP_CAPABILITIES,
    listResponseSchema: formPlacementGroupGrantRouteSchemas.listResponseSchema as z.ZodType<ResourceGrantListResponse>,
    mutationResponseSchema: formPlacementGroupGrantRouteSchemas.mutationResponseSchema,
  },
  vote: {
    path: "votes",
    capabilities: VOTE_GROUP_CAPABILITIES,
    listResponseSchema: voteGroupGrantRouteSchemas.listResponseSchema as z.ZodType<ResourceGrantListResponse>,
    mutationResponseSchema: voteGroupGrantRouteSchemas.mutationResponseSchema,
  },
  mailingList: {
    path: "mailing-lists",
    capabilities: MAILING_LIST_GROUP_CAPABILITIES,
    listResponseSchema: mailingListGroupGrantRouteSchemas.listResponseSchema as z.ZodType<ResourceGrantListResponse>,
    mutationResponseSchema: mailingListGroupGrantRouteSchemas.mutationResponseSchema,
  },
};

const resourceLabels: Record<ResourceSharingKind, string> = {
  event: "event",
  formPlacement: "form placement",
  vote: "vote",
  mailingList: "mailing list",
};

function capabilityLabel(capability: string): string {
  return capability.replaceAll("_", " ");
}

/**
 * Shared owner-only editor for group resource grants. The API remains the
 * authority for authorization; callers render this only for an owning group
 * with the resource's effective manage capability.
 */
export function ResourceSharingEditor({
  kind,
  groupId,
  resourceId,
  ownerGroupId,
}: {
  kind: ResourceSharingKind;
  groupId: string;
  resourceId: string;
  ownerGroupId: string;
}) {
  const config = resourceSharingConfigs[kind];
  const resourceLabel = resourceLabels[kind];
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/${config.path}/${encodeURIComponent(resourceId)}/grants`;
  const tableActions = useRef<ApiTableActions | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [capability, setCapability] = useState(config.capabilities[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function addGrant(event: Event): Promise<void> {
    event.preventDefault();
    if (!selectedGroup || !capability) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await postJson(endpoint, { granteeGroupId: selectedGroup.id, capability }, config.mutationResponseSchema);
      setSelectedGroup(null);
      setSaved(true);
      await tableActions.current?.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add the sharing grant.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeGrant(grant: ResourceGrant): Promise<void> {
    const capability = capabilityLabel(grant.capability);
    if (
      !(await confirmAction({
        title: `Revoke ${capability} access for ${grant.granteeGroup.name}?`,
        body: `This removes ${grant.granteeGroup.name}'s ability to ${capability} this ${resourceLabel}.`,
        consequences: [`Members of ${grant.granteeGroup.name} immediately lose this access`],
        confirmLabel: "Revoke access",
      }))
    )
      return;
    setError(null);
    setSaved(false);
    try {
      await deleteJson(
        `${endpoint}/${encodeURIComponent(grant.granteeGroup.id)}/${encodeURIComponent(grant.capability)}`,
        successResponseSchema,
      );
      await tableActions.current?.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke the sharing grant.");
    }
  }

  return (
    <section class="card border-0 shadow-sm mt-3" aria-label={`${resourceLabel} sharing`}>
      <div class="card-header bg-white fw-semibold">Sharing</div>
      <div class="card-body">
        <p class="small text-muted">
          Share this {resourceLabel} with another managed group. The owning group retains management access.
        </p>
        <form class="row g-2 align-items-end mb-3" onSubmit={addGrant}>
          <div class="col-lg-6">
            <ServerSearchSelect
              catalog={managedGroupCatalog}
              label="Group"
              value={selectedGroup?.id ?? null}
              selectedLabel={selectedGroup?.name}
              placeholder="Select a group…"
              excludeValues={[ownerGroupId]}
              onChange={(group) => setSelectedGroup(group)}
            />
          </div>
          <div class="col-sm-6 col-lg-4">
            <label class="form-label small fw-semibold mb-1" htmlFor={`${kind}-${resourceId}-capability`}>
              Capability
            </label>
            <select
              id={`${kind}-${resourceId}-capability`}
              aria-label="Capability"
              class="form-select form-select-sm"
              value={capability}
              disabled={saving}
              onChange={(event) => setCapability((event.target as HTMLSelectElement).value)}
            >
              {config.capabilities.map((value) => (
                <option key={value} value={value}>
                  {capabilityLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div class="col-sm-6 col-lg-2">
            <button type="submit" class="btn btn-sm btn-primary w-100" disabled={saving || !selectedGroup}>
              {saving ? "Saving…" : "Share"}
            </button>
          </div>
        </form>
        {saved && (
          <div class="alert alert-success py-2" role="status">
            Sharing grant saved.
          </div>
        )}
        <ErrorAlert error={error} />
        <ApiDataTable
          endpoint={endpoint}
          responseSchema={config.listResponseSchema}
          resolve={(response) => response.grants}
          resolvePage={(response) => response.page}
          paginate
          searchPlaceholder="Search shared groups…"
          initialSort="group"
          actionsRef={tableActions}
          columns={[
            { header: "Group", cell: (grant) => grant.granteeGroup.name, sort: { asc: "group", desc: "-group" } },
            {
              header: "Capability",
              cell: (grant) => capabilityLabel(grant.capability),
              sort: { asc: "capability", desc: "-capability" },
            },
            {
              header: "",
              className: "text-end",
              cell: (grant) => (
                <RowActions
                  label={`Actions for ${grant.granteeGroup.name}`}
                  actions={[{ key: "revoke", label: "Revoke", onSelect: () => void revokeGrant(grant) }]}
                />
              ),
            },
          ]}
          empty="This resource is not shared with any other group."
          rowKey={(grant) => `${grant.granteeGroup.id}:${grant.capability}`}
        />
      </div>
    </section>
  );
}
