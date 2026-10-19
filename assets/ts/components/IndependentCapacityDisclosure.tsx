import { INDEPENDENT_CAPACITY_COPY as copy } from "../../shared/email-first-copy";
import {
  INDEPENDENT_CAPACITY_DISCLOSURE_VERSION,
  independentCapacityDisclosureSchema,
  type IndependentCapacityDisclosure,
} from "../../shared/schemas/independent-capacity";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Checkbox, Radio } from "../ui/Checkbox";
import { Field } from "../ui/Field";
import { FormSection } from "../ui/FormSection";
import { TextInput, Textarea } from "../ui/TextControl";
import { ExternalLink } from "../ui/ExternalLink";

/** What the person has answered so far; the contract decides when it is complete. */
export type IndependentCapacityDraft = Partial<Omit<IndependentCapacityDisclosure, "version">>;

/** The complete disclosure the draft makes, or null while the contract still refuses it. */
export function completedIndependentCapacity(draft: IndependentCapacityDraft): IndependentCapacityDisclosure | null {
  const parsed = independentCapacityDisclosureSchema.safeParse({
    ...draft,
    version: INDEPENDENT_CAPACITY_DISCLOSURE_VERSION,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The short independence disclosure a speaker completes to take part as an
 * individual. "Yes" to the organization question ends the independent path
 * here and steers to the organization's work address; "No" asks for the
 * attestations the shared contract requires.
 */
export function IndependentCapacityDisclosure({
  draft,
  onChange,
  onUseWorkEmail,
}: {
  draft: IndependentCapacityDraft;
  onChange: (draft: IndependentCapacityDraft) => void;
  onUseWorkEmail: () => void;
}) {
  const form = useContractForm(independentCapacityDisclosureSchema, {
    ...draft,
    version: INDEPENDENT_CAPACITY_DISCLOSURE_VERSION,
  });
  const set = <Key extends keyof IndependentCapacityDraft>(key: Key, value: IndependentCapacityDraft[Key]) =>
    onChange({ ...draft, [key]: value });
  const confirmations = [
    ["noRelatedEngagement", copy.noRelatedEngagement],
    ["acceptsAccountability", copy.accountability],
  ] as const;
  const confirmationIssue = [...confirmations.map(([name]) => name), "acknowledgesPolicies" as const]
    .map((name) => form.of(name))
    .find((presentation) => presentation.state === "invalid");
  return (
    <FormSection title={copy.title} description={copy.intro}>
      <div class="pk-stack" {...form.handlers}>
        <Field
          group
          label={copy.question}
          {...(draft.organizationConnection === "yes" ? {} : form.of("organizationConnection"))}
        >
          {() => (
            <div class="pk-cluster">
              {(["no", "yes"] as const).map((answer) => (
                <Radio
                  key={answer}
                  name="organizationConnection"
                  value={answer}
                  checked={draft.organizationConnection === answer}
                  onChange={() => set("organizationConnection", answer)}
                  label={copy[answer]}
                />
              ))}
            </div>
          )}
        </Field>
        {draft.organizationConnection === "yes" && (
          <Alert tone="warn" title={copy.connectedTitle}>
            <p>{copy.connectedSteer}</p>
            <div class="pk-cluster">
              <Button type="button" variant="primary" onClick={onUseWorkEmail}>
                {copy.useWorkEmail}
              </Button>
            </div>
          </Alert>
        )}
        {draft.organizationConnection === "no" && (
          <>
            <Field
              label={copy.formerAffiliationsLabel}
              help={copy.formerAffiliationsHelp}
              {...form.of("formerAffiliations")}
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="formerAffiliations"
                  rows={3}
                  value={draft.formerAffiliations ?? ""}
                  onInput={(event) => set("formerAffiliations", event.currentTarget.value)}
                />
              )}
            </Field>
            <Field label={copy.currentPositionLabel} help={copy.currentPositionHelp} {...form.of("currentPosition")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="currentPosition"
                  value={draft.currentPosition ?? ""}
                  onInput={(event) => set("currentPosition", event.currentTarget.value)}
                />
              )}
            </Field>
            <Field group label={copy.confirmationsLabel} {...(confirmationIssue ?? {})}>
              {() => (
                <div class="pk-stack pk-stack--snug">
                  {confirmations.map(([name, label]) => (
                    <Checkbox
                      key={name}
                      name={name}
                      checked={draft[name] === true}
                      onChange={(event) => set(name, event.currentTarget.checked ? true : undefined)}
                      label={label}
                    />
                  ))}
                  <Checkbox
                    name="acknowledgesPolicies"
                    checked={draft.acknowledgesPolicies === true}
                    onChange={(event) => set("acknowledgesPolicies", event.currentTarget.checked ? true : undefined)}
                    label={
                      <>
                        {copy.policyBefore}
                        <ExternalLink href={copy.iprPolicyHref} external>
                          {copy.iprPolicy}
                        </ExternalLink>
                        {copy.policyBetween}
                        <ExternalLink href={copy.codeOfConductHref} external>
                          {copy.codeOfConduct}
                        </ExternalLink>
                        {copy.policyAfter}
                      </>
                    }
                  />
                </div>
              )}
            </Field>
          </>
        )}
      </div>
    </FormSection>
  );
}
