/** Check invitation access before collecting details; preserve the form during recovery. */
import { render } from "preact";
import { useState } from "preact/hooks";
import { inviteInfoResponseSchema } from "../../shared/schemas/invites";
import { inviteResendLinkSchema } from "../../shared/schemas/proposal-management";
import { successResponseSchema } from "../../shared/schemas/api-common";
import type { EventRegistrationPolicy } from "../../shared/schemas/event-series";
import { parseEventFlowPath } from "../../shared/event-flow-paths";
import { ApiClientError, getJson, postJson } from "../shared/api-client";
import { readField } from "../shared/form/helpers";
import { clearStatus } from "../shared/form/validation";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { Spinner } from "../components/Spinner";
import type { FlowBoot } from "./boot";

type InviteState = "invalid" | "expired" | "already_processed" | "unavailable";
const RECOVERABLE_CODES = new Set(["INVITE_INVALID", "INVITE_NOT_FOUND", "INVITE_EXPIRED"]);
const TITLES: Record<InviteState, string> = {
  invalid: "This invitation link is not valid",
  expired: "This invitation has expired",
  already_processed: "This invitation has already been used",
  unavailable: "We could not check your invitation",
};

function InvitationRecovery({
  state,
  boot,
  canContinue,
  retry,
  proceed,
}: {
  state: InviteState;
  boot: FlowBoot;
  canContinue: boolean;
  retry: () => void;
  proceed: () => void;
}) {
  const [email, setEmail] = useState(readField(boot.form, "email"));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contract = useContractForm(inviteResendLinkSchema, { email });
  const processed = state === "already_processed";
  const endpoint = processed
    ? `${boot.apiBase}/events/${boot.eventSlug}/registrations/resend-manage-link`
    : `${boot.apiBase}/invites/resend-link`;
  return (
    <Panel aria-label="Invitation access">
      <PanelHeader title={TITLES[state]} />
      <PanelBody class="pk-stack">
        <p>Your registration details have not been submitted. Anything you entered is still in this page.</p>
        {state === "unavailable" ? (
          <Button onClick={retry}>Try checking again</Button>
        ) : (
          <>
            <p>
              {processed
                ? "If you already registered, request a link to manage your registration."
                : "Request a fresh link for an active invitation. If the invitation itself has expired, ask the organizer to renew it."}
            </p>
            {sent ? (
              <Alert tone="ok">
                {processed
                  ? "If a registration matches this address, a management link will arrive by email."
                  : "If an active invitation matches this address, a fresh link will arrive by email."}
              </Alert>
            ) : (
              <form
                noValidate
                {...contract.handlers}
                class="pk-stack"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  const result = contract.submit();
                  if (!result.data) {
                    setError(result.message);
                    return;
                  }
                  setBusy(true);
                  setError(null);
                  try {
                    await postJson(endpoint, result.data, successResponseSchema);
                    setSent(true);
                  } catch (cause) {
                    setError(contract.refuse(cause));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label="Email address" {...contract.of("email")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onInput={(event) => setEmail(event.currentTarget.value)}
                    />
                  )}
                </Field>
                {error && <Alert tone="danger">{error}</Alert>}
                <div>
                  <Button type="submit" loading={busy}>
                    {processed ? "Send management link" : "Send fresh invitation link"}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
        {canContinue && state !== "unavailable" && (
          <>
            <p>
              This event also accepts public registration. You can continue without this invitation and confirm your
              email afterward.
            </p>
            <div>
              <Button variant="primary" onClick={proceed}>
                Continue without invitation
              </Button>
            </div>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

export function registrationInvitation(boot: FlowBoot) {
  let policy: EventRegistrationPolicy | undefined;
  let allowed = !boot.query.inviteToken;
  const mount = document.createElement("div");
  mount.tabIndex = -1;
  const stepper = boot.root.querySelector<HTMLElement>(".event-flow-stepper");
  boot.root.prepend(mount);
  function visible(show: boolean) {
    boot.form.hidden = !show;
    if (stepper) stepper.hidden = !show;
    mount.hidden = show;
  }
  visible(allowed);
  if (!allowed) render(<Spinner label="Checking invitation…" />, mount);

  function proceed() {
    boot.query.inviteToken = null;
    boot.query.inviteId = null;
    if (boot.query.sourceType === "invite" || boot.query.sourceType === "speaker_invite")
      boot.query.sourceType = "direct";
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    url.searchParams.delete("id");
    if (["invite", "speaker_invite"].includes(url.searchParams.get("source") ?? "")) url.searchParams.delete("source");
    window.history.replaceState(window.history.state, "", url);
    allowed = true;
    visible(true);
    clearStatus(boot.statusEl);
    boot.form.querySelector<HTMLElement>("[data-step].is-active input:not([type='hidden'])")?.focus();
  }
  function recover(state: InviteState) {
    allowed = false;
    visible(false);
    render(
      <InvitationRecovery
        key={state}
        state={state}
        boot={boot}
        canContinue={policy === "public"}
        retry={() => void check(policy)}
        proceed={proceed}
      />,
      mount,
    );
    mount.focus();
  }
  async function check(registrationPolicy?: EventRegistrationPolicy) {
    policy = registrationPolicy;
    if (!boot.query.inviteToken) return;
    allowed = false;
    visible(false);
    render(<Spinner label="Checking invitation…" />, mount);
    try {
      const suffix = boot.query.inviteId ? `?id=${encodeURIComponent(boot.query.inviteId)}` : "";
      const info = await getJson(
        `${boot.apiBase}/invites/${encodeURIComponent(boot.query.inviteToken)}/info${suffix}`,
        inviteInfoResponseSchema,
      );
      if (info.status !== "valid") {
        recover(info.status);
        return;
      }
      const path = info.registrationUrl ? new URL(info.registrationUrl, window.location.origin) : null;
      const eventSlug = path ? (parseEventFlowPath(path.pathname)?.eventSlug ?? path.searchParams.get("event")) : null;
      if (info.inviteType !== "attendee" || eventSlug !== boot.eventSlug) {
        recover("invalid");
        return;
      }
      allowed = true;
      visible(true);
    } catch (cause) {
      recover(cause instanceof ApiClientError && cause.status === 400 ? "invalid" : "unavailable");
    }
  }
  return {
    check,
    canSubmit: () => allowed,
    loadFailed() {
      allowed = false;
      visible(true);
    },
    handleError(error: unknown) {
      if (!boot.query.inviteToken || !(error instanceof ApiClientError) || !RECOVERABLE_CODES.has(error.code))
        return false;
      recover(error.code === "INVITE_EXPIRED" ? "expired" : "invalid");
      return true;
    },
  };
}
