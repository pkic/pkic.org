/** The production address-add form, shared by account settings and representation onboarding. */
import { EmailFirstStep, type EmailFirstController } from "../EmailFirstStep";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ownRepresentationEmailAddSchema,
  ownEmailVerificationRequestedResponseSchema,
} from "../../../shared/schemas/own-email-addresses";
import { userEmailAddResponseSchema, userEmailAddSchema } from "../../../shared/schemas/user-emails";
import type { ImmediateEmailDelivery } from "../../../shared/schemas/email-outbox";
import { useContractForm } from "../../hooks/useContractForm";
import { postJson } from "../../shared/api-client";
import { OWN_EMAILS_ENDPOINT } from "../../shared/email-address-paths";
import { Alert } from "../../ui/Alert";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import { Button } from "../../ui/Button";
import { nextDomId } from "../../ui/dom-id";

export function EmailAddressCreateForm({
  userId,
  isSelf,
  onAdded,
  beforeAdd,
  onBusy,
  actions,
  embedded = false,
  onIndividualChange,
}: {
  userId?: string;
  isSelf: boolean;
  /** `delivery` is set for the person's own address: whether its verification link went out. */
  onAdded: (added: { email: string; individual?: boolean; delivery?: ImmediateEmailDelivery }) => void | Promise<void>;
  beforeAdd?: (email: string, individual?: boolean) => Promise<boolean>;
  onIndividualChange?: (individual: boolean) => void;
  onBusy?: (busy: boolean) => void;
  actions?: ComponentChildren;
  embedded?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [individual, setIndividual] = useState(false);
  const controller = useRef<EmailFirstController>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formId] = useState(() => nextDomId("email"));
  const form = useContractForm(userEmailAddSchema, { email });
  useEffect(() => onBusy?.(saving), [saving]);
  if (embedded)
    return (
      <form
        noValidate
        aria-label="Add email address"
        class="pk-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.current.continue?.();
        }}
      >
        <EmailFirstStep
          flow="representation"
          controller={controller.current}
          onBusy={setSaving}
          schema={ownRepresentationEmailAddSchema}
          body={{ purpose: "representation" }}
          email={email}
          onEmailChange={setEmail}
          individual={individual}
          onIndividualChange={(value) => {
            setIndividual(value);
            onIndividualChange?.(value);
          }}
          onContinue={async (step) => {
            if (beforeAdd && (await beforeAdd(step.email, step.unaffiliatedAttestation))) return;
            const added = await postJson(OWN_EMAILS_ENDPOINT, step, ownEmailVerificationRequestedResponseSchema);
            await onAdded({
              email: added.email,
              individual: step.unaffiliatedAttestation,
              delivery: added.delivery,
            });
          }}
        />
      </form>
    );
  return (
    <form
      noValidate
      class="pk-stack pk-stack--snug"
      aria-label="Add email address"
      {...form.handlers}
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const checked = form.submit();
        // The refused field says why and takes focus; an alert would only repeat it.
        if (!checked.data) return;
        setSaving(true);
        try {
          if (beforeAdd && (await beforeAdd(checked.data.email))) return;
          if (isSelf) {
            const added = await postJson(
              OWN_EMAILS_ENDPOINT,
              checked.data,
              ownEmailVerificationRequestedResponseSchema,
            );
            await onAdded({ email: added.email, delivery: added.delivery });
          } else {
            const added = await postJson(
              `/api/v1/users/${encodeURIComponent(userId!)}/emails`,
              checked.data,
              userEmailAddResponseSchema,
            );
            await onAdded({ email: added.email.email });
          }
        } catch (cause) {
          setError(form.refuse(cause));
        } finally {
          setSaving(false);
        }
      }}
    >
      <Field
        id={`${formId}-address`}
        label="Email address"
        required
        help={
          isSelf
            ? "We send a link to confirm it is yours. A verified work address links you to your organization."
            : "A secondary address is for account association only. It does not allow signing in."
        }
        {...form.of("email")}
      >
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
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving}>
          {isSelf ? "Send verification link" : "Add email address"}
        </Button>
        {actions}
      </div>
    </form>
  );
}
