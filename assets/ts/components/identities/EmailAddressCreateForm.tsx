/** The production address-add form, shared by account settings and representation onboarding. */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ownEmailAddressResponseSchema } from "../../../shared/schemas/own-email-addresses";
import { userEmailAddResponseSchema, userEmailAddSchema } from "../../../shared/schemas/user-emails";
import { useContractForm } from "../../hooks/useContractForm";
import { postJson } from "../../shared/api-client";
import { OWN_EMAILS_ENDPOINT } from "../../shared/email-address-paths";
import { Alert } from "../../ui/Alert";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import { Button } from "../../ui/Button";

export function EmailAddressCreateForm({
  userId,
  isSelf,
  onAdded,
  beforeAdd,
  onBusy,
  actions,
  embedded = false,
}: {
  userId?: string;
  isSelf: boolean;
  onAdded: (email: string) => void | Promise<void>;
  beforeAdd?: (email: string) => Promise<boolean>;
  onBusy?: (busy: boolean) => void;
  actions?: ComponentChildren;
  embedded?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formId] = useState(() => `email-${crypto.randomUUID()}`);
  const form = useContractForm(userEmailAddSchema, { email });
  useEffect(() => onBusy?.(saving), [saving]);
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
        if (!checked.data) return setError(checked.message);
        setSaving(true);
        try {
          if (beforeAdd && (await beforeAdd(checked.data.email))) return;
          if (isSelf) {
            const added = await postJson(OWN_EMAILS_ENDPOINT, checked.data, ownEmailAddressResponseSchema);
            await onAdded(added.email.email);
          } else {
            const added = await postJson(
              `/api/v1/users/${encodeURIComponent(userId!)}/emails`,
              checked.data,
              userEmailAddResponseSchema,
            );
            await onAdded(added.email.email);
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
        label={embedded ? "Representation email" : "Email address"}
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
      {!embedded && (
        <div class="pk-cluster">
          <Button type="submit" variant="primary" loading={saving}>
            {isSelf ? "Send verification link" : "Add email address"}
          </Button>
          {actions}
        </div>
      )}
    </form>
  );
}
