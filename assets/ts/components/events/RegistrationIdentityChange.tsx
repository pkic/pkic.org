/** The same owned-identity picker and add flow, embedded in registration self-service. */
import type { ComponentChildren } from "preact";
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
  children,
}: {
  data: RegistrationManageReadResponse;
  onChanged: () => void | Promise<void>;
  /** Multiple field pencils share this one dialog and its update flow. */
  children?: (edit: (label: string) => ComponentChildren) => ComponentChildren;
}) {
  const [open, show, close] = useDialogQueryState("representation");
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<SessionActingIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshPending, setRefreshPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const profileEdited = useRef(false);
  const contract = useContractForm(registrationIdentityChangeSchema, {
    identityId: selected?.id,
    expectedIdentityId: data.identityId ?? null,
  });
  const resetContract = contract.reset;
  useEffect(() => {
    if (!open) return;
    profileEdited.current = false;
    let active = true;
    setLoading(true);
    setError("");
    resetContract();
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
  }, [open, data, resetContract]);
  async function refresh(): Promise<void> {
    try {
      await onChanged();
      setRefreshPending(false);
      setError("");
    } catch {
      setError("Your changes were saved, but the registration could not be refreshed. Try refreshing again.");
    }
  }
  const edit = (label: string = "Change representation") => (
    <Button
      variant="ghost"
      icon
      aria-label={label}
      title={label}
      loading={loading}
      disabled={refreshPending}
      onClick={show}
    >
      <IconPencil />
    </Button>
  );
  return (
    <>
      {children ? children(edit) : edit()}
      {!open && error && <Alert tone="danger">{error}</Alert>}
      {!open && refreshPending && (
        <Button type="button" onClick={() => void refresh()}>
          Retry refresh
        </Button>
      )}
      {createPortal(
        <Dialog
          open={open}
          title="Change representation"
          closeLabel="Close change representation"
          confirmLabel={refreshPending ? "Retry refresh" : session ? "Save changes" : "Close"}
          cancelLabel={session ? "Cancel" : null}
          confirmDisabled={busy || loading}
          onConfirm={() => {
            if (session) form.current?.requestSubmit();
            else void close().catch((cause: unknown) => setError(contract.refuse(cause)));
          }}
          onCancel={() => {
            if (busy) return;
            void (async () => {
              await close();
              if (profileEdited.current) {
                setRefreshPending(true);
                await refresh();
              }
            })().catch((cause: unknown) => setError(contract.refuse(cause)));
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          {loading ? (
            <Spinner label="Loading your representations…" />
          ) : session ? (
            <form
              ref={form}
              noValidate
              {...contract.handlers}
              class="pk-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    if (!refreshPending) {
                      const checked = contract.submit();
                      if (!checked.data) return setError(checked.formMessage ?? "");
                      await putJson(
                        `/api/v1/registrations/${encodeURIComponent(data.registration.id)}/identity`,
                        checked.data,
                        registrationIdentityChangeResponseSchema,
                      );
                      setRefreshPending(true);
                    }
                    await close();
                    await refresh();
                  } catch (cause) {
                    setError(contract.refuse(cause));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {refreshPending && <p>Your changes were saved. Continue to refresh the registration.</p>}
              {open && !refreshPending && (
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
