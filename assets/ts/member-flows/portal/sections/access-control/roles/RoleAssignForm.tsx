import { useState } from "preact/hooks";
import { UserPicker, type PickedUser } from "../../../../../components/UserPicker";
import { postJson } from "../../../../../shared/api-client";
import { toast } from "../../../ui";
import { userRoleResponseEnvelopeSchema } from "../../../../../../shared/schemas/access-control";
import { TargetPicker, type PickedTarget } from "../TargetPicker";

/** Assigns the fixed role of an open RoleDetail — the same endpoint/schema UserRoles.tsx assigns through. */
export function RoleAssignForm({ roleId, onAssigned }: { roleId: string; onAssigned: () => void }) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [target, setTarget] = useState<PickedTarget>({ targetType: null, targetId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAssign(e: Event) {
    e.preventDefault();
    if (!user) {
      toast("Pick a user first", "error");
      return;
    }
    if (target.targetType && !target.targetId) {
      toast("Pick a specific event/working group, or clear the context", "error");
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        `/api/v1/users/${user.id}/roles`,
        {
          roleId,
          contextType: target.targetType,
          contextId: target.targetId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
        userRoleResponseEnvelopeSchema,
      );
      toast("Role assigned", "success");
      setUser(null);
      setTarget({ targetType: null, targetId: null });
      setExpiresAt("");
      onAssigned();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleAssign} class="row g-2 align-items-end mb-3">
      <div class="col-md-4">
        <label class="form-label small fw-semibold">User</label>
        <UserPicker endpoint="/api/v1/permissions/subjects" value={user} onChange={setUser} disabled={submitting} />
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold">Target</label>
        <TargetPicker value={target} onChange={setTarget} disabled={submitting} />
      </div>
      <div class="col-md-2">
        <label class="form-label small fw-semibold">Expires (optional)</label>
        <input
          class="form-control form-control-sm"
          type="datetime-local"
          value={expiresAt}
          onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
          disabled={submitting}
        />
      </div>
      <div class="col-md-2">
        <button type="submit" class="btn btn-sm btn-success w-100" disabled={submitting || !user}>
          {submitting ? "Assigning…" : "Assign"}
        </button>
      </div>
    </form>
  );
}
