import { useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { z } from "zod";
import { memberJoinVerifySchema, memberJoinVerifyResponseSchema } from "../../shared/schemas/member-join";
import { VerifiedOrganizationCreateDialog } from "../components/identities/VerifiedOrganizationCreateDialog";
import { IconPlus } from "../components/icons";
import { useContractForm } from "../hooks/useContractForm";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { InputGroup } from "../ui/InputGroup";
import { Select } from "../ui/TextControl";

export function JoinOrganizationChoice({
  token,
  domain,
  affiliation,
  organizations,
  onChoose,
  onResolve,
  onAdd,
  onIndividual,
}: {
  token: string;
  domain: string;
  affiliation: Extract<
    z.infer<typeof memberJoinVerifyResponseSchema>,
    { status: "organization_selection_required" }
  >["affiliation"];
  organizations: Array<{ id: string; name: string }>;
  onChoose: (id: string) => Promise<void>;
  onResolve: (domain?: string) => Promise<typeof affiliation>;
  onAdd: (name: string, domain: string) => Promise<void>;
  onIndividual?: () => Promise<void>;
}) {
  const [organizationId, setOrganizationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const form = useContractForm(memberJoinVerifySchema.required({ organizationId: true }), { token, organizationId });
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
      <h2>{onIndividual ? "How would you like to join?" : "Choose your organization"}</h2>
      <p>
        {onIndividual
          ? `Choose a member organization at @${domain} to join it, or continue with an individual application.`
          : organizations.length
            ? `Choose the organization you represent at @${domain}.`
            : `Add the organization you represent at @${domain}.`}
      </p>
      <Field
        label="Organization"
        required={!onIndividual}
        help={
          onIndividual
            ? "Choose an organization only if you want to join it. You can continue as an individual without choosing."
            : organizations.length
              ? "Choose the organization you represent."
              : "Use + to add your organization."
        }
        {...form.of("organizationId")}
      >
        {(control) => (
          <InputGroup>
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
            {!onIndividual && (
              <Button
                type="button"
                variant="secondary"
                icon
                aria-label="Add organization"
                title="Add organization"
                disabled={busy}
                onClick={() => setAdding(true)}
              >
                <IconPlus />
              </Button>
            )}
          </InputGroup>
        )}
      </Field>
      {organizations.length > 0 && (
        <Button type="submit" variant="primary" loading={busy}>
          {onIndividual ? "Join organization" : "Continue"}
        </Button>
      )}
      {onIndividual && (
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
      )}
      {createPortal(
        <VerifiedOrganizationCreateDialog
          initial={affiliation}
          open={adding}
          resolve={onResolve}
          onClose={() => setAdding(false)}
          onUse={(organization) => {
            setAdding(false);
            setBusy(true);
            void onAdd(organization.name, organization.resolved.domain).finally(() => setBusy(false));
          }}
        />,
        document.body,
      )}
    </form>
  );
}
