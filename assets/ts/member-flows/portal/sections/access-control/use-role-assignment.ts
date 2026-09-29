/**
 * Assigning a role to a person, from either side of the same act.
 *
 * `UserRoles` starts from a person and picks the role; `RoleAssignForm` starts
 * from an open role and picks the person. It is one command either way — the
 * same draft, the same contract, the same route, the same refusal handling —
 * so the whole of it lives here and each surface contributes only the picker
 * that differs and what it does once the assignment lands.
 */
import { useState } from "preact/hooks";

import { useContractForm, type ContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import {
  userRoleAssignSchema,
  userRoleResponseEnvelopeSchema,
  type UserRoleAssignInput,
} from "../../../../../shared/schemas/access-control";
import type { PickedUser } from "../../../../components/UserPicker";
import type { PickedTarget } from "./TargetPicker";

const NO_TARGET: PickedTarget = { targetType: null, targetId: null };

export interface RoleAssignment {
  /** The contract's live view of the draft, for the form and its fields. */
  form: ContractForm<UserRoleAssignInput>;
  submitting: boolean;
  /** The refusal to show above the controls, or null. */
  formError: string | null;
  user: PickedUser | null;
  setUser: (user: PickedUser | null) => void;
  target: PickedTarget;
  setTarget: (target: PickedTarget) => void;
  /** A `datetime-local` value; empty means an assignment that never expires. */
  expiresAt: string;
  setExpiresAt: (value: string) => void;
  /** Checks the draft, assigns, and on success clears it and calls `onAssigned`. */
  handleAssign: (event: Event) => Promise<void>;
}

export function useRoleAssignment({
  roleId,
  initialUser = null,
  onAssigned,
}: {
  /** Fixed where the surface opens on a role; picked where it opens on a person. */
  roleId: string;
  /** Fixed where the surface opens on a person. */
  initialUser?: PickedUser | null;
  onAssigned: () => void | Promise<void>;
}): RoleAssignment {
  const [user, setUser] = useState<PickedUser | null>(initialUser);
  const [target, setTarget] = useState<PickedTarget>(NO_TARGET);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /*
   * One basis for validation: `userRoleAssignSchema`, the contract the route
   * parses. Its `validateScopedContext` already says a context type and a
   * context id arrive together — a rule both surfaces used to restate by hand,
   * in their own words, where the two could drift apart.
   */
  const form = useContractForm(userRoleAssignSchema, {
    roleId,
    contextType: target.targetType,
    contextId: target.targetId,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
  });

  async function handleAssign(event: Event): Promise<void> {
    event.preventDefault();
    setFormError(null);
    // The person is the path, not the body, so no body contract speaks for
    // them: a refusal naming `userId` would highlight nothing, because the
    // picker is not a contract-wired control.
    if (!user) {
      setFormError("Pick a user first.");
      return;
    }
    const checked = form.submit();
    if (!checked.data) {
      setFormError(checked.message);
      return;
    }
    setSubmitting(true);
    try {
      await postJson(`/api/v1/users/${user.id}/roles`, checked.data, userRoleResponseEnvelopeSchema);
      setTarget(NO_TARGET);
      setExpiresAt("");
      form.reset();
      await onAssigned();
    } catch (cause) {
      // A server refusal names its fields the way the contract does.
      setFormError(form.refuse(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return {
    form,
    submitting,
    formError,
    user,
    setUser,
    target,
    setTarget,
    expiresAt,
    setExpiresAt,
    handleAssign,
  };
}
