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
  createdIdentityId,
  onAdd,
  onClose,
  onCorrected,
}: {
  open: boolean;
  source: { identityId: string; organizationId: string; organizationName: string };
  userId: string;
  isSelf: boolean;
  createdIdentityId?: string | null;
  onAdd: () => void;
  onClose: () => void;
  onCorrected: () => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<ActingIdentity | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = isSelf ? "/api/v1/users/current/identities" : "/api/v1/identities";
  const form = useContractForm(identityCorrectionSchema, { replacementIdentityId: selected?.id, reason });
  useEffect(() => {
    if (!open || !createdIdentityId) return;
    let cancelled = false;
    const query = new URLSearchParams({
      identityId: createdIdentityId,
      userId,
      active: "true",
      organizationOnly: "true",
      limit: "1",
    });
    void getJson(`${endpoint}?${query}`, identitiesListResponseSchema)
      .then((result) => {
        if (!cancelled && result.identities[0]) setSelected(result.identities[0]);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the representation.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, createdIdentityId, userId, endpoint]);
  async function submit() {
    const checked = form.submit();
    if (!checked.data) return;
    setBusy(true);
    setError("");
    try {
      await postJson(
        `/api/v1/users/${encodeURIComponent(userId)}/identities/${encodeURIComponent(source.identityId)}/corrections`,
        checked.data,
        identityMutationResponseSchema,
      );
      await onCorrected();
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
      title="Correct organization"
      closeLabel="Close organization correction"
      description={`Remove the incorrect association with ${source.organizationName} from experience history. Registration and speaker records will use the representation you choose. Access granted through the incorrect association will be removed. Accept the other representation’s invitation or add it first if it is not listed.`}
      confirmLabel="Correct organization"
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
          organizationOnly
          required
          excludeIdentityId={source.identityId}
          excludeOrganizationId={source.organizationId}
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
