/**
 * Working Groups — self-service join/leave. Backend
 * enforces the CA working group's category-A-only constraint ("CA WG
 * constraint enforced at the API level", `assertCaConstraint` in
 * working-groups.ts). The authenticated list endpoint also applies catalog
 * eligibility, so this view only renders backend-selected data.
 */
import { useState } from "preact/hooks";
import type { z } from "zod";
import { postJson, deleteJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { useApiPage } from "../../../hooks/useApiPage";
import { toast, fmt } from "../ui";
import { myWorkingGroupsListResponseSchema } from "../../../../shared/schemas/me";
import type { WorkingGroupSummary, MyWorkingGroupMembership } from "../types";

type MyWorkingGroupsPage = z.infer<typeof myWorkingGroupsListResponseSchema>;

function WorkingGroupCard({
  wg,
  membership,
  onChanged,
}: {
  wg: WorkingGroupSummary;
  membership: MyWorkingGroupMembership | undefined;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const joined = Boolean(membership);

  async function join(): Promise<void> {
    setBusy(true);
    try {
      await postJson(`/api/v1/me/working-groups/${wg.slug}`, {});
      toast(`Joined ${wg.name}`, "success");
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not join this working group.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function leave(): Promise<void> {
    if (!confirm(`Leave ${wg.name}?`)) return;
    setBusy(true);
    try {
      await deleteJson(`/api/v1/me/working-groups/${wg.slug}`);
      toast(`Left ${wg.name}`, "success");
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not leave this working group.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-body d-flex justify-content-between align-items-start gap-3">
        <div>
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold">{wg.name}</span>
            {joined && <span class="badge text-bg-success">Joined</span>}
          </div>
          {wg.description && <p class="text-muted small mb-0 mt-1">{wg.description}</p>}
          {membership && <p class="text-muted small mb-0 mt-1">Joined {fmt(membership.joinedAt)}</p>}
        </div>
        {joined ? (
          <button
            type="button"
            class="btn btn-sm btn-outline-danger flex-shrink-0"
            disabled={busy}
            onClick={() => void leave()}
          >
            {busy ? "Leaving…" : "Leave"}
          </button>
        ) : (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary flex-shrink-0"
            disabled={busy}
            onClick={() => void join()}
          >
            {busy ? "Joining…" : "Join"}
          </button>
        )}
      </div>
    </div>
  );
}

export function WorkingGroups() {
  const catalog = useApiPage<MyWorkingGroupsPage>(
    "/api/v1/me/working-groups",
    { view: "catalog" },
    myWorkingGroupsListResponseSchema,
    (data) => data.workingGroups,
  );
  const groups = catalog.data?.workingGroups ?? [];
  const error = catalog.error;

  if (error) {
    return <ErrorAlert error={error instanceof ApiClientError ? error.message : "Could not load working groups."} />;
  }
  if (!catalog.data) return <Spinner />;
  if (groups.length === 0 && !catalog.data.page.hasMore) {
    return <p class="text-muted">No working groups are available right now.</p>;
  }

  return (
    <div class="d-flex flex-column gap-3 content-width-schedule">
      <p class="text-muted small">
        Join or leave working groups at any time. Joining adds you to the group's mailing list and meeting calendar;
        leaving removes both.
      </p>
      {groups.map((entry) => {
        const wg: WorkingGroupSummary = entry;
        const membership: MyWorkingGroupMembership | undefined = entry.joinedAt
          ? { workingGroupId: entry.workingGroupId, slug: entry.slug, name: entry.name, joinedAt: entry.joinedAt }
          : undefined;
        return <WorkingGroupCard key={wg.id} wg={wg} membership={membership} onChanged={catalog.reload} />;
      })}
      {catalog.pagerProps && <Pager {...catalog.pagerProps} />}
    </div>
  );
}
