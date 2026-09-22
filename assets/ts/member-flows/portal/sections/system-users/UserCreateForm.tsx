import { useState } from "preact/hooks";
import { userCreateSchema, userCreateResponseSchema } from "../../../../../shared/schemas/user-create";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { Button, ButtonLink } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { Alert } from "../../../../ui/Alert";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";

export function UserCreateForm() {
  const [, navigate] = usePortalHashLocation();
  const [body, setBody] = useState({ email: "", firstName: "", lastName: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(userCreateSchema, body);
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await postJson("/api/v1/users", checked.data, userCreateResponseSchema);
      navigate(`/users/${created.userId}`);
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Create user" breadcrumb />
      <PanelBody>
        <form noValidate class="pk-form pk-stack" {...form.handlers} onSubmit={(event) => void submit(event)}>
          <p>Create a person record, then add their affiliations from the user page.</p>
          {error && <Alert tone="danger">{error}</Alert>}
          {(
            [
              ["email", "Email address"],
              ["firstName", "First name"],
              ["lastName", "Last name"],
            ] as const
          ).map(([name, label]) => (
            <Field key={name} label={label} required={name === "email"} {...form.of(name)}>
              {(control) => (
                <TextInput
                  {...control}
                  name={name}
                  type={name === "email" ? "email" : "text"}
                  value={body[name]}
                  onInput={(event) => setBody({ ...body, [name]: event.currentTarget.value })}
                />
              )}
            </Field>
          ))}
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={busy}>
              Create user
            </Button>
            <ButtonLink href={usePortalHashLocation.hrefs("/users")}>Cancel</ButtonLink>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
