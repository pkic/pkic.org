import { useState } from "preact/hooks";
import { memberJoinVerifySchema } from "../../shared/schemas/member-join";
import { useContractForm } from "../hooks/useContractForm";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Select } from "../ui/TextControl";

/**
 * An individual applicant whose domain has member organizations: they may join
 * one of those instead, or continue with their individual application.
 */
export function JoinOrganizationChoice({
  domain,
  organizations,
  onChoose,
  onIndividual,
}: {
  domain: string;
  organizations: Array<{ id: string; name: string }>;
  onChoose: (id: string) => Promise<void>;
  onIndividual: () => Promise<void>;
}) {
  const [organizationId, setOrganizationId] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(memberJoinVerifySchema.required({ organizationId: true }), { organizationId });
  return (
    <form
      noValidate
      class="pk-stack"
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        const checked = form.submit();
        if (checked.data) {
          setBusy(true);
          void onChoose(checked.data.organizationId).finally(() => setBusy(false));
        }
      }}
    >
      <h2>How would you like to join?</h2>
      <p>Choose a member organization at @{domain} to join it, or continue with an individual application.</p>
      <Field
        label="Organization"
        help="Choose an organization only if you want to join it. You can continue as an individual without choosing."
        {...form.of("organizationId")}
      >
        {(control) => (
          <Select
            {...control}
            value={organizationId}
            onChange={(event) => setOrganizationId(event.currentTarget.value)}
          >
            <option value="">Choose an organization</option>
            {organizations.map((organization) => (
              <option value={organization.id} key={organization.id}>
                {organization.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {organizations.length > 0 && (
        <Button type="submit" variant="primary" loading={busy}>
          Join organization
        </Button>
      )}
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onIndividual().finally(() => setBusy(false));
        }}
      >
        Continue as an individual
      </Button>
    </form>
  );
}
