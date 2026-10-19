/**
 * Adding an email address: a form of its own under the user record,
 * validated by the contract the route parses. The person's own address is
 * kept as waiting for verification and receives a link; staff add a
 * secondary address to another user's record. The way back is the record.
 */
import { useState } from "preact/hooks";
import { ownEmailAddressResponseSchema } from "../../../../shared/schemas/own-email-addresses";
import { userEmailAddResponseSchema, userEmailAddSchema } from "../../../../shared/schemas/user-emails";
import { useContractForm } from "../../../hooks/useContractForm";
import { postJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { Breadcrumb } from "../../../ui/Breadcrumb";
import { Button, ButtonLink } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { TextInput } from "../../../ui/TextControl";
import { usePortalHashLocation } from "../hash-location";
import { toast } from "../ui";
import { OWN_EMAILS_ENDPOINT } from "./email-address-paths";

export function EmailAddressAddForm({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const recordPath = `/users/${encodeURIComponent(userId)}`;
  const [, navigate] = usePortalHashLocation();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(userEmailAddSchema, { email });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    try {
      if (isSelf) {
        const added = await postJson(OWN_EMAILS_ENDPOINT, checked.data, ownEmailAddressResponseSchema);
        toast(`Check ${added.email.email} for the verification link`, "success");
      } else {
        const added = await postJson(
          `/api/v1/users/${encodeURIComponent(userId)}/emails`,
          checked.data,
          userEmailAddResponseSchema,
        );
        toast(`${added.email.email} added`, "success");
      }
      navigate(recordPath);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section class="pk pk-stack" aria-label="Add an email address">
      <Breadcrumb
        items={[
          isSelf
            ? { label: "My profile", href: usePortalHashLocation.hrefs(recordPath) }
            : { label: "Users", href: usePortalHashLocation.hrefs("/users") },
          ...(isSelf ? [] : [{ label: "User record", href: usePortalHashLocation.hrefs(recordPath) }]),
          { label: "Add an email address" },
        ]}
      />
      <Panel aria-label="Add an email address">
        <PanelHeader title="Add an email address" />
        <PanelBody>
          <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={(event) => void submit(event)}>
            <Field
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
              <ButtonLink variant="ghost" href={usePortalHashLocation.hrefs(recordPath)}>
                Cancel
              </ButtonLink>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </section>
  );
}
