import { useEffect, useState } from "preact/hooks";
import type { ActingIdentity } from "../../../shared/schemas/identity";
import {
  identityCorrectionSchema,
  identityMutationResponseSchema,
  identitiesListResponseSchema,
} from "../../../shared/schemas/identity";
import { useContractForm } from "../../hooks/useContractForm";
import { getJson, postJson } from "../../shared/api-client";
import { Alert } from "../../ui/Alert";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Textarea } from "../../ui/TextControl";
import { RepresentationSelect } from "./RepresentationSelect";

export function RepresentationCorrectionDialog({
  open,
  source,
  userId,
  isSelf,
  preselectIdentityId,
  onAdd,
  onClose,
  onCorrected,
}: {
  open: boolean;
  source: { identityId: string; organizationId: string | null; organizationName: string };
  userId: string;
  isSelf: boolean;
  /**
   * The identity the correction most likely moves to: one just added for it,
   * otherwise the one the person acts as. Ignored when it is the identity
   * being corrected or belongs to the same organization.
   */
  preselectIdentityId?: string | null;
  onAdd: () => void;
  onClose: () => void;
  onCorrected: (replacement: ActingIdentity) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<ActingIdentity | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = isSelf ? "/api/v1/users/current/identities" : "/api/v1/identities";
  const form = useContractForm(identityCorrectionSchema, { replacementIdentityId: selected?.id, reason });
  useEffect(() => {
    if (!open || !preselectIdentityId || preselectIdentityId === source.identityId) return;
    let cancelled = false;
    const query = new URLSearchParams({
      identityId: preselectIdentityId,
      userId,
      active: "true",
      limit: "1",
    });
    void getJson(`${endpoint}?${query}`, identitiesListResponseSchema)
      .then((result) => {
        const candidate = result.identities[0];
        const sameOrganization = Boolean(source.organizationId) && candidate?.organizationId === source.organizationId;
        if (!cancelled && candidate && !sameOrganization) setSelected(candidate);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the representation.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, preselectIdentityId, source.identityId, source.organizationId, userId, endpoint]);
  async function submit() {
    const checked = form.submit();
    if (!checked.data || !selected) return;
    const replacement = selected;
    setBusy(true);
    setError("");
    try {
      await postJson(
        `/api/v1/users/${encodeURIComponent(userId)}/identities/${encodeURIComponent(source.identityId)}/corrections`,
        checked.data,
        identityMutationResponseSchema,
      );
      await onCorrected(replacement);
      onClose();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      title="Correct identity"
      closeLabel="Close identity correction"
      description={`${source.organizationId ? "Choose Personal or the correct organization." : "Choose the correct organization."} Linked registrations and speaker records move with the correction. The incorrect ${source.organizationName} identity and its access are removed; the user account remains.`}
      confirmLabel="Correct identity"
      confirmDisabled={busy}
      onConfirm={() => void submit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <RepresentationSelect
          endpoint={endpoint}
          userId={userId}
          value={selected}
          onSelect={setSelected}
          onAdd={onAdd}
          required
          excludeIdentityId={source.identityId}
          excludeOrganizationId={source.organizationId ?? undefined}
          validation={form.of("replacementIdentityId")}
        />
        <Field label="Reason for correction" required {...form.of("reason")}>
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              value={reason}
              onInput={(event) => setReason(event.currentTarget.value)}
            />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
