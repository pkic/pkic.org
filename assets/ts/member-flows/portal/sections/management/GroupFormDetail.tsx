import { usePortalHashLocation } from "../../hash-location";
import {
  groupFormDefinitionResponseSchema,
  groupFormSubmissionResponseSchema,
  groupFormSubmissionStatsResponseSchema,
  groupFormSubmissionsResponseSchema,
} from "../../../../../shared/schemas/group-forms";
import { FormResponseStats, FormSubmissionsTable } from "../../../../components/forms/FormResponseViews";
import { FormSubmissionForm } from "../../../../components/forms/FormSubmissionForm";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson } from "../../../../shared/api-client";
import { GroupFormEditor } from "./GroupFormEditor";
import { GroupFormPlacementEditor } from "./GroupFormPlacementEditor";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

type GroupFormTab = "respond" | "statistics" | "responses" | "definition" | "availability" | "sharing";

const DEFAULT_TAB: GroupFormTab = "respond";

export function GroupFormDetail({
  groupId,
  placementId,
  initialTab,
  onChanged,
}: {
  groupId: string;
  placementId: string;
  /** The URL-addressed tab segment, if any. Undefined or unrecognized selects the default tab. */
  initialTab?: string;
  onChanged: () => void | Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/forms/${encodeURIComponent(placementId)}`;
  const requestedTab = (initialTab as GroupFormTab | undefined) ?? DEFAULT_TAB;
  const detail = useData(() => getJson(base, groupFormDefinitionResponseSchema), [base]);
  const canViewResponses = detail.data?.capabilities.includes("view_responses") ?? false;
  const canSubmitResponse =
    (detail.data?.capabilities.includes("submit") ?? false) && (detail.data?.acceptingResponses ?? false);
  const shouldLoadStats =
    canViewResponses && (requestedTab === "statistics" || (!canSubmitResponse && requestedTab === "respond"));
  const stats = useData(
    () =>
      shouldLoadStats
        ? getJson(`${base}/submissions/stats`, groupFormSubmissionStatsResponseSchema)
        : Promise.resolve(null),
    [base, shouldLoadStats],
  );

  if (detail.loading) return <Spinner />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;

  const form = detail.data;
  const canSubmit = canSubmitResponse;
  const canManagePlacement = form.capabilities.includes("manage");
  const canManageDefinition = canManagePlacement && form.placement.ownerGroupId === groupId;
  const tabs: TabItem[] = [
    ...(canSubmit ? [{ key: "respond", label: "Respond" }] : []),
    ...(canViewResponses
      ? [
          { key: "statistics", label: "Statistics" },
          { key: "responses", label: "Responses" },
        ]
      : []),
    ...(canManageDefinition ? [{ key: "definition", label: "Edit form" }] : []),
    ...(canManagePlacement ? [{ key: "availability", label: "Availability" }] : []),
    ...(canManageDefinition ? [{ key: "sharing", label: "Sharing" }] : []),
  ];
  const activeTab = tabs.some((item) => item.key === requestedTab)
    ? requestedTab
    : (tabs[0]?.key as GroupFormTab | undefined);

  function tabPath(key: string): string {
    return `/groups/${encodeURIComponent(groupId)}/forms/${encodeURIComponent(placementId)}/${key}`;
  }

  function goToTab(key: string): void {
    navigate(tabPath(key));
  }

  async function reload(): Promise<void> {
    await Promise.all([detail.reload(), shouldLoadStats ? stats.reload() : Promise.resolve(), onChanged()]);
  }

  return (
    <div class="p-3 bg-body-tertiary">
      <div class="mb-3">
        <h6 class="mb-1">{form.form.title}</h6>
        {form.form.description && <p class="small text-muted mb-0">{form.form.description}</p>}
      </div>
      {tabs.length > 1 && <Tabs items={tabs} active={activeTab ?? ""} onChange={goToTab} hrefFor={tabPath} />}
      {!activeTab && <p class="small text-muted mb-0">No actions are available for this form.</p>}
      {activeTab === "respond" && (
        <FormSubmissionForm
          fields={form.fields}
          onSubmit={async (answers) => {
            await postJson(`${base}/submissions`, { answers }, groupFormSubmissionResponseSchema);
          }}
        />
      )}
      {activeTab === "statistics" &&
        (stats.loading ? (
          <Spinner />
        ) : stats.error ? (
          <ErrorAlert error={stats.error} />
        ) : stats.data ? (
          <FormResponseStats fields={form.fields} stats={stats.data.stats} total={stats.data.total} />
        ) : null)}
      {activeTab === "responses" && (
        <FormSubmissionsTable
          fields={form.fields}
          endpoint={`${base}/submissions`}
          responseSchema={groupFormSubmissionsResponseSchema}
        />
      )}
      {activeTab === "definition" && (
        <GroupFormEditor
          groupId={groupId}
          placementId={placementId}
          detail={form}
          onSaved={reload}
          onCancel={() => goToTab(canViewResponses ? "statistics" : "availability")}
        />
      )}
      {activeTab === "availability" && (
        <GroupFormPlacementEditor groupId={groupId} placement={form.placement} onSaved={reload} />
      )}
      {activeTab === "sharing" && canManageDefinition && form.placement.ownerGroupId && (
        <ResourceSharingEditor
          kind="formPlacement"
          groupId={groupId}
          resourceId={form.placement.id}
          ownerGroupId={form.placement.ownerGroupId}
        />
      )}
    </div>
  );
}
