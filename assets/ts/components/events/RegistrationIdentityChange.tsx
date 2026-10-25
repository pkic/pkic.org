/** The same owned-identity picker and add flow, embedded in registration self-service. */
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import {
  registrationIdentityChangeSchema,
  registrationIdentityChangeResponseSchema,
} from "../../../shared/schemas/registration-identity";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import type { SessionActingIdentity } from "../../../shared/session-acting-identity";
import { useContractForm } from "../../hooks/useContractForm";
import { getJson, putJson } from "../../shared/api-client";
import { Button, ButtonLink } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Alert } from "../../ui/Alert";
import { RegistrationIdentityField } from "../RegistrationIdentitySelect";

type Session = ReturnType<typeof userAuthSessionResponseSchema.parse>;
export function RegistrationIdentityChange({
  data,
  onChanged,
}: {
  data: RegistrationManageReadResponse;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<SessionActingIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const contract = useContractForm(registrationIdentityChangeSchema, {
    identityId: selected?.id,
    expectedIdentityId: data.identityId ?? null,
  });
  async function start() {
    setLoading(true);
    setError("");
    contract.reset();
    const current = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
    const owner = current?.identity.email.toLowerCase() === data.user.email.toLowerCase() ? current : null;
    setSession(owner);
    setSelected(
      owner?.actingIdentities.find((identity) => identity.id === data.identityId) ??
        owner?.actingIdentities.find(
          (identity) =>
            identity.organizationName === data.user.organization_name && identity.jobTitle === data.user.job_title,
        ) ??
        null,
    );
    setOpen(true);
    setLoading(false);
  }
  return (
    <>
      <Button variant="secondary" loading={loading} onClick={() => void start()}>
        Change representation
      </Button>
      {createPortal(
        <Dialog
          open={open}
          title="Change representation"
          closeLabel="Close change representation"
          confirmLabel={session ? "Save changes" : "Close"}
          cancelLabel={session ? "Cancel" : null}
          confirmDisabled={busy}
          onConfirm={() => (session ? form.current?.requestSubmit() : setOpen(false))}
          onCancel={() => {
            if (!busy) setOpen(false);
          }}
        >
          {session ? (
            <form
              ref={form}
              noValidate
              {...contract.handlers}
              class="pk-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                const checked = contract.submit();
                if (!checked.data) return setError(checked.message);
                setBusy(true);
                setError("");
                try {
                  await putJson(
                    `/api/v1/registrations/${encodeURIComponent(data.registration.id)}/identity`,
                    checked.data,
                    registrationIdentityChangeResponseSchema,
                  );
                  setOpen(false);
                  await onChanged();
                } catch (cause) {
                  setError(contract.refuse(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {error && <Alert tone="danger">{error}</Alert>}
              {open && (
                <RegistrationIdentityField
                  preferred={selected}
                  available={session.actingIdentities}
                  userId={session.identity.id}
                  onSelect={setSelected}
                />
              )}
            </form>
          ) : (
            <div class="pk-stack">
              <p>Sign in as {data.user.email} to choose or add a representation. Then return to this page.</p>
              <ButtonLink href="/portal/" external>
                Sign in
              </ButtonLink>
            </div>
          )}
        </Dialog>,
        document.body,
      )}
    </>
  );
}
