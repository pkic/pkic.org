/** The same owned-identity picker and add flow, embedded in registration self-service. */
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
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
import { useDialogQueryState } from "../../hooks/useDialogQueryState";
import { IconPencil } from "../icons";
import { Spinner } from "../Spinner";

type Session = ReturnType<typeof userAuthSessionResponseSchema.parse>;
export function RegistrationIdentityChange({
  data,
  onChanged,
}: {
  data: RegistrationManageReadResponse;
  onChanged: () => void | Promise<void>;
}) {
  const [open, show, close] = useDialogQueryState("representation");
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<SessionActingIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const profileEdited = useRef(false);
  const contract = useContractForm(registrationIdentityChangeSchema, {
    identityId: selected?.id,
    expectedIdentityId: data.identityId ?? null,
  });
  useEffect(() => {
    if (!open) return;
    profileEdited.current = false;
    let active = true;
    setLoading(true);
    setError("");
    contract.reset();
    void getJson("/api/v1/auth/session", userAuthSessionResponseSchema)
      .catch(() => null)
      .then((current) => {
        if (!active) return;
        const owner =
          current &&
          (current.actingIdentities.some((identity) => identity.id === data.identityId) ||
            current.identity.email.toLowerCase() === data.user.email.toLowerCase())
            ? current
            : null;
        setSession(owner);
        setSelected(owner?.actingIdentities.find((identity) => identity.id === data.identityId) ?? null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, data]);
  return (
    <>
      <Button
        variant="ghost"
        icon
        aria-label="Change representation"
        title="Change representation"
        loading={loading}
        onClick={show}
      >
        <IconPencil />
      </Button>
      {createPortal(
        <Dialog
          open={open}
          title="Change representation"
          closeLabel="Close change representation"
          confirmLabel={session ? "Save changes" : "Close"}
          cancelLabel={session ? "Cancel" : null}
          confirmDisabled={busy || loading}
          onConfirm={() => (session ? form.current?.requestSubmit() : close())}
          onCancel={async () => {
            if (busy) return;
            await close();
            if (profileEdited.current) await onChanged();
          }}
        >
          {loading ? (
            <Spinner label="Loading your representations…" />
          ) : session ? (
            <form
              ref={form}
              noValidate
              {...contract.handlers}
              class="pk-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                const checked = contract.submit();
                if (!checked.data) return setError(checked.formMessage ?? "");
                setBusy(true);
                setError("");
                try {
                  await putJson(
                    `/api/v1/registrations/${encodeURIComponent(data.registration.id)}/identity`,
                    checked.data,
                    registrationIdentityChangeResponseSchema,
                  );
                  await close();
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
                  presentation="picker"
                  preferred={selected}
                  available={session.actingIdentities}
                  userId={session.identity.id}
                  onSelect={setSelected}
                  onUpdated={() => {
                    profileEdited.current = true;
                  }}
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
