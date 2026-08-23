import { useEffect, useRef, useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../../components/Spinner";
import { ApiDataTable, type ApiTableActions } from "../../components/ApiDataTable";
import { api, apiCommand } from "../../api";
import { fmt, toast } from "../../ui";
import type { AdminWorkingGroupDetail, AdminWorkingGroupMember } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";
import { adminWorkingGroupCatalog } from "../../services/catalogs";
import { performAdminAction } from "../../actions";
import {
  workingGroupMembersListResponseSchema,
  workingGroupResponseSchema,
} from "../../../../shared/schemas/working-groups";
import { runGoogleGroupsSync } from "../../services/google-groups-sync";
import { ServerSearchSelect } from "../../components/ServerSearchSelect";

/**
 * WG management: create/edit working groups, add/remove
 * members directly, view WG rosters. Chair/vice-chair assignment (with
 * term expiry) moved to the dedicated "Chairs" section — this tab only
 * displays the current holders and their term expiry read-only, to avoid
 * two places editing the same user_roles rows. Create/edit/deactivate and
 * member add/remove hit the admin-only /api/v1/admin/working-groups
 * endpoints (unfiltered by active, full roster with user ids) rather than
 * the public GET /api/v1/working-groups this tab used previously.
 */

function CreateWorkingGroupForm({ onCreated }: { onCreated: () => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mailingListEmail, setMailingListEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    await performAdminAction({
      setBusy: setSaving,
      request: () =>
        api("/api/v1/admin/working-groups", workingGroupResponseSchema, {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            mailingListEmail: mailingListEmail.trim() || null,
          }),
        }),
      successMessage: "Working group created",
      afterSuccess: () => {
        setName("");
        setDescription("");
        setMailingListEmail("");
        setShow(false);
        onCreated();
      },
    });
  }

  if (!show) {
    return (
      <button class="btn btn-sm btn-outline-success mb-3" onClick={() => setShow(true)}>
        + Create working group
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} class="border rounded p-3 mb-3 bg-light">
      <div class="row g-2">
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Name</label>
          <input
            class="form-control form-control-sm"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            disabled={saving}
            required
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Mailing list email</label>
          <input
            type="email"
            class="form-control form-control-sm"
            value={mailingListEmail}
            onInput={(e) => setMailingListEmail((e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Description</label>
          <input
            class="form-control form-control-sm"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        </div>
      </div>
      <div class="mt-2 d-flex gap-2">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving || !name.trim()}>
          {saving ? "Creating…" : "Create"}
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setShow(false)} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function WorkingGroups() {
  const [, navigate] = useHashLocation();
  const [selectedId, setSelectedId] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string>();
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [detail, setDetail] = useState<AdminWorkingGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [addMemberUser, setAddMemberUser] = useState<PickedUser | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const memberTableRef = useRef<ApiTableActions | null>(null);

  function loadGroups(keepSelection = true): void {
    if (!keepSelection) {
      setSelectedId("");
      setSelectedLabel(undefined);
    }
    setCatalogRevision((current) => current + 1);
  }

  useEffect(() => {
    void loadGroups(false);
  }, []);

  async function loadDetail() {
    if (!selectedId) return;
    setLoading(true);
    try {
      const d = await api(`/api/v1/admin/working-groups/${selectedId}`, workingGroupResponseSchema);
      setDetail(d.workingGroup);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [selectedId]);

  async function handleAddMember(e: Event) {
    e.preventDefault();
    if (!addMemberUser || !selectedId) return;
    setAddingMember(true);
    try {
      await apiCommand(`/api/v1/admin/working-groups/${selectedId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: addMemberUser.id }),
      });
      toast("Member added", "success");
      setAddMemberUser(null);
      await Promise.all([loadDetail(), loadGroups()]);
      memberTableRef.current?.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(userId: string, name: string) {
    if (!selectedId) return;
    if (!confirm(`Remove ${name} from this working group?`)) return;
    try {
      await apiCommand(`/api/v1/admin/working-groups/${selectedId}/members/${userId}`, { method: "DELETE" });
      toast("Member removed", "success");
      await Promise.all([loadDetail(), loadGroups()]);
      memberTableRef.current?.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  /**
   * "Add a sync button to the working groups to force a google group sync
   * after any changes have been made to the members of the working group"
   * (2026-07-30 testing feedback). Reuses the same on-demand drain endpoint
   * the Mailing Lists tab's "Sync now" button already calls — a working
   * group's roster is synced to Google Groups via its mailing_list_email,
   * so there's nothing WG-specific to scope the drain to; it just processes
   * whatever is pending, same as the mailing-lists button.
   */
  async function handleSyncNow() {
    setSyncing(true);
    try {
      await runGoogleGroupsSync();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleActive() {
    if (!detail) return;
    const next = !detail.active;
    if (next === false && detail.memberCount > 0) {
      if (!confirm(`Deactivate "${detail.name}"? It still has ${detail.memberCount} member(s) on its roster.`)) return;
    }
    setTogglingActive(true);
    try {
      await api(`/api/v1/admin/working-groups/${detail.id}`, workingGroupResponseSchema, {
        method: "PATCH",
        body: JSON.stringify({ active: next }),
      });
      toast(next ? "Working group reactivated" : "Working group deactivated", "success");
      await Promise.all([loadDetail(), loadGroups()]);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setTogglingActive(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
        <span>Working group management</span>
        <button type="button" class="btn btn-outline-success btn-sm" disabled={syncing} onClick={handleSyncNow}>
          {syncing ? "Syncing…" : "↺ Sync Google Group now"}
        </button>
      </div>
      <div class="card-body">
        <CreateWorkingGroupForm onCreated={() => void loadGroups(false)} />

        <div class="mb-3 adm-filter-control">
          <ServerSearchSelect
            key={catalogRevision}
            catalog={adminWorkingGroupCatalog}
            label="Working group"
            value={selectedId}
            selectedLabel={selectedLabel ?? detail?.name}
            allowEmpty={false}
            autoSelectFirst
            onChange={(group) => {
              setSelectedId(group?.id ?? "");
              setSelectedLabel(group ? adminWorkingGroupCatalog.itemLabel(group) : undefined);
            }}
          />
        </div>

        {loading ? (
          <Spinner />
        ) : detail ? (
          <>
            <div class="d-flex align-items-center gap-2 mb-3">
              <span class={`badge text-bg-${detail.active ? "success" : "secondary"}`}>
                {detail.active ? "Active" : "Inactive"}
              </span>
              <button
                class={`btn btn-sm ${detail.active ? "btn-outline-danger" : "btn-outline-success"}`}
                disabled={togglingActive}
                onClick={handleToggleActive}
              >
                {togglingActive ? "Saving…" : detail.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-md-6">
                <div class="small fw-semibold mb-1">Chair</div>
                {detail.chair ? (
                  <div>
                    <span>
                      {detail.chair.name} <span class="text-muted small">({detail.chair.email})</span>
                    </span>
                    <div class="text-muted small">
                      {detail.chair.expiresAt ? `Term expires ${fmt(detail.chair.expiresAt)}` : "No expiry set"}
                    </div>
                  </div>
                ) : (
                  <span class="text-muted fst-italic small">Not assigned</span>
                )}
              </div>
              <div class="col-md-6">
                <div class="small fw-semibold mb-1">Vice chair</div>
                {detail.viceChair ? (
                  <div>
                    <span>
                      {detail.viceChair.name} <span class="text-muted small">({detail.viceChair.email})</span>
                    </span>
                    <div class="text-muted small">
                      {detail.viceChair.expiresAt ? `Term expires ${fmt(detail.viceChair.expiresAt)}` : "No expiry set"}
                    </div>
                  </div>
                ) : (
                  <span class="text-muted fst-italic small">Not assigned</span>
                )}
              </div>
              <div class="col-12">
                <span class="small text-muted fst-italic">
                  Chair and vice chair are assigned from the "Leadership" section.
                </span>
              </div>
            </div>

            <form onSubmit={handleAddMember} class="row g-2 align-items-end mb-3">
              <div class="col-md-8">
                <label class="form-label small fw-semibold">Add member</label>
                <UserPicker value={addMemberUser} onChange={setAddMemberUser} disabled={addingMember} />
              </div>
              <div class="col-md-4">
                <button type="submit" class="btn btn-sm btn-success" disabled={addingMember || !addMemberUser}>
                  {addingMember ? "Adding…" : "Add member"}
                </button>
              </div>
            </form>

            <div class="fw-semibold small mb-2">Roster ({detail.memberCount})</div>
            <ApiDataTable<AdminWorkingGroupMember>
              endpoint={`/api/v1/admin/working-groups/${selectedId}/members`}
              responseSchema={workingGroupMembersListResponseSchema}
              resolve={(data) => workingGroupMembersListResponseSchema.parse(data).members}
              resolvePage={(data) => workingGroupMembersListResponseSchema.parse(data).page}
              paginate
              searchPlaceholder="Search members…"
              initialSort="name"
              actionsRef={memberTableRef}
              rowKey={(member) => member.userId}
              empty="No members"
              columns={[
                {
                  header: "Name",
                  sort: { asc: "name", desc: "-name" },
                  cell: (member) => (
                    <button
                      type="button"
                      class="btn btn-link p-0"
                      onClick={() => navigate(`/users/detail/${member.userId}`)}
                      title="View user details"
                    >
                      {member.name}
                    </button>
                  ),
                },
                {
                  header: "Organization",
                  sort: { asc: "organization_name", desc: "-organization_name" },
                  cell: (member) => member.organizationName ?? "—",
                  className: "text-muted small",
                },
                {
                  header: "Category",
                  sort: { asc: "member_category", desc: "-member_category" },
                  cell: (member) => member.memberCategory ?? "—",
                  className: "text-muted small mono",
                },
                {
                  header: "",
                  cell: (member) => (
                    <button
                      class="btn btn-sm btn-outline-danger"
                      onClick={() => void handleRemoveMember(member.userId, member.name)}
                    >
                      Remove
                    </button>
                  ),
                  className: "text-end",
                },
              ]}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
