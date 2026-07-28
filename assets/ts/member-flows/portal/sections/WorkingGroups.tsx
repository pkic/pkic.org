/**
 * Working Groups — self-service join/leave (PRD §4.9, §11 UI-3). Backend
 * enforces the CA working group's category-A-only constraint (§4.9's "CA WG
 * constraint enforced at the API level") — this component doesn't
 * duplicate that check client-side, it just surfaces the 403's message via
 * toast when a non-category-A member tries to join.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, postJson, deleteJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { toast, fmt } from "../ui";
import type { WorkingGroupSummary, MyWorkingGroupMembership } from "../types";

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
  const [groups, setGroups] = useState<WorkingGroupSummary[] | null>(null);
  const [memberships, setMemberships] = useState<MyWorkingGroupMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [groupsData, membershipsData] = await Promise.all([
        getJson<{ workingGroups: WorkingGroupSummary[] }>("/api/v1/working-groups"),
        getJson<{ workingGroups: MyWorkingGroupMembership[] }>("/api/v1/me/working-groups"),
      ]);
      setGroups(groupsData.workingGroups);
      setMemberships(membershipsData.workingGroups);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load working groups.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <ErrorAlert error={error} />;
  if (!groups || !memberships) return <Spinner />;
  if (groups.length === 0) return <p class="text-muted">No working groups are available right now.</p>;

  const membershipByWgId = new Map(memberships.map((m) => [m.workingGroupId, m]));

  return (
    <div class="d-flex flex-column gap-3" style="max-width: 700px;">
      <p class="text-muted small">
        Join or leave working groups at any time. Joining adds you to the group's mailing list and meeting calendar;
        leaving removes both.
      </p>
      {groups.map((wg) => (
        <WorkingGroupCard key={wg.id} wg={wg} membership={membershipByWgId.get(wg.id)} onChanged={reload} />
      ))}
    </div>
  );
}
