import { currencyInfo, CURRENCIES, toSmallestUnit } from "../../../../../shared/constants/currencies";
import {
  membershipWorkflowStepSchema,
  type MembershipWorkflowStep,
} from "../../../../../shared/schemas/membership-workflows";
import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { Field } from "../../../../ui/Field";
import { Select, TextInput, Textarea } from "../../../../ui/TextControl";
import { WorkflowGroupSelect, WorkflowDestinationSelect } from "./WorkflowReferenceSelect";

const objectionHandlingLabels: Record<
  Extract<MembershipWorkflowStep, { kind: "consensus" }>["objectionHandling"],
  string
> = {
  hold_for_resolution: "Wait for resolution",
  refer_next: "Refer to the following review",
};

export function newWorkflowStep(kind: MembershipWorkflowStep["kind"]): MembershipWorkflowStep {
  const base = { id: crypto.randomUUID(), label: "", instructions: "" };
  if (kind === "staff_review") return { ...base, kind, label: "Staff review", reviewerGroupId: null };
  if (kind === "consensus")
    return {
      ...base,
      kind,
      label: "Member consultation",
      audience: { kind: "active_voting_members" },
      destination: { kind: "external", email: "" },
      durationDays: 7,
      objectionHandling: "hold_for_resolution",
    };
  return { ...base, kind, label: "Membership fee", feeReference: "", amount: 10000, currency: "usd", deadlineDays: 30 };
}
export function WorkflowStepFields({
  step,
  position,
  of,
  onChange,
}: {
  step: MembershipWorkflowStep;
  position: number;
  of: (name: string) => FieldPresentation;
  onChange: (step: MembershipWorkflowStep) => void;
}) {
  const name = (field: string) => `definition.steps.${position}.${field}`;
  return (
    <div class="pk-stack">
      <Field label="Step name" {...of(name("label"))} required>
        {(control) => (
          <TextInput
            {...control}
            name={name("label")}
            value={step.label}
            onInput={(event) => onChange({ ...step, label: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field
        label="Applicant instructions"
        {...of(name("instructions"))}
        help="Explain what the applicant or reviewer needs to do."
      >
        {(control) => (
          <Textarea
            {...control}
            name={name("instructions")}
            value={step.instructions}
            onInput={(event) => onChange({ ...step, instructions: event.currentTarget.value })}
          />
        )}
      </Field>
      {step.kind === "staff_review" && (
        <Field
          label="Reviewer group"
          {...of(name("reviewerGroupId"))}
          help="Leave empty to require membership approval permission."
        >
          {(control) => (
            <WorkflowGroupSelect
              {...control}
              name={name("reviewerGroupId")}
              value={step.reviewerGroupId}
              onChange={(id) => onChange({ ...step, reviewerGroupId: id })}
            />
          )}
        </Field>
      )}
      {step.kind === "consensus" && (
        <>
          <Field label="Who can respond" {...of(name("audience.kind"))}>
            {(control) => (
              <Select
                {...control}
                name={name("audience.kind")}
                value={step.audience.kind}
                onChange={(event) => {
                  const kind = event.currentTarget.value;
                  onChange({
                    ...step,
                    audience:
                      kind === "group"
                        ? { kind, groupId: "" }
                        : kind === "executive_council"
                          ? { kind }
                          : { kind: "active_voting_members" },
                  });
                }}
              >
                <option value="active_voting_members">Active voting members</option>
                <option value="executive_council">Executive Council</option>
                <option value="group">Selected group members</option>
              </Select>
            )}
          </Field>
          {step.audience.kind === "group" && (
            <Field label="Eligible group" {...of(name("audience.groupId"))} required>
              {(control) => (
                <WorkflowGroupSelect
                  {...control}
                  name={name("audience.groupId")}
                  value={step.audience.kind === "group" ? step.audience.groupId : null}
                  onChange={(id) => onChange({ ...step, audience: { kind: "group", groupId: id ?? "" } })}
                />
              )}
            </Field>
          )}
          <Field
            label="Where to notify"
            {...of(name("destination.kind"))}
            help="The destination receives the notice; it does not grant permission to respond."
          >
            {(control) => (
              <Select
                {...control}
                name={name("destination.kind")}
                value={step.destination.kind}
                onChange={(event) =>
                  onChange({
                    ...step,
                    destination:
                      event.currentTarget.value === "mailing_list"
                        ? { kind: "mailing_list", mailingListId: "" }
                        : { kind: "external", email: "" },
                  })
                }
              >
                <option value="mailing_list">Managed mailing list</option>
                <option value="external">External mailing list address</option>
              </Select>
            )}
          </Field>
          {step.destination.kind === "mailing_list" ? (
            <Field label="Notification list" {...of(name("destination.mailingListId"))} required>
              {(control) => (
                <WorkflowDestinationSelect
                  {...control}
                  name={name("destination.mailingListId")}
                  value={step.destination.kind === "mailing_list" ? step.destination.mailingListId : null}
                  onChange={(id) =>
                    onChange({ ...step, destination: { kind: "mailing_list", mailingListId: id ?? "" } })
                  }
                />
              )}
            </Field>
          ) : (
            <Field label="External list email" {...of(name("destination.email"))} required>
              {(control) => (
                <TextInput
                  {...control}
                  name={name("destination.email")}
                  type="email"
                  value={step.destination.kind === "external" ? step.destination.email : ""}
                  onInput={(event) =>
                    onChange({ ...step, destination: { kind: "external", email: event.currentTarget.value } })
                  }
                />
              )}
            </Field>
          )}
          <Field
            label="Response window (days)"
            {...of(name("durationDays"))}
            help="Starts when the provider accepts the notice for sending."
          >
            {(control) => (
              <TextInput
                {...control}
                name={name("durationDays")}
                type="number"
                value={step.durationDays}
                onInput={(event) => onChange({ ...step, durationDays: Number(event.currentTarget.value) })}
              />
            )}
          </Field>
          <Field label="When an objection is raised" {...of(name("objectionHandling"))}>
            {(control) => (
              <Select
                {...control}
                name={name("objectionHandling")}
                value={step.objectionHandling}
                onChange={(event) =>
                  onChange({
                    ...step,
                    objectionHandling:
                      event.currentTarget.value === "refer_next" ? "refer_next" : "hold_for_resolution",
                  })
                }
              >
                {membershipWorkflowStepSchema.options[1].shape.objectionHandling.options.map((value) => (
                  <option key={value} value={value}>
                    {objectionHandlingLabels[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
      {step.kind === "payment" && (
        <>
          <Field
            label="Fee or product reference"
            {...of(name("feeReference"))}
            required
            help="Enter a short name for this fee, such as Organization membership. Applicants see it at checkout. Set the price in Fee amount below; no URL or Stripe product ID is needed."
          >
            {(control) => (
              <TextInput
                {...control}
                name={name("feeReference")}
                value={step.feeReference}
                onInput={(event) => onChange({ ...step, feeReference: event.currentTarget.value })}
              />
            )}
          </Field>
          <Field label={`Fee amount (${step.currency.toUpperCase()})`} {...of(name("amount"))}>
            {(control) => (
              <TextInput
                {...control}
                name={name("amount")}
                type="number"
                value={step.amount / (currencyInfo(step.currency).zeroDecimal ? 1 : 100)}
                step={currencyInfo(step.currency).zeroDecimal ? "1" : "0.01"}
                onInput={(event) =>
                  onChange({
                    ...step,
                    amount: toSmallestUnit(Number(event.currentTarget.value), step.currency),
                  })
                }
              />
            )}
          </Field>
          <Field label="Currency" {...of(name("currency"))}>
            {(control) => (
              <Select
                {...control}
                name={name("currency")}
                value={step.currency}
                onChange={(event) => onChange({ ...step, currency: event.currentTarget.value })}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.name} ({currency.code.toUpperCase()})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Payment deadline (days)" {...of(name("deadlineDays"))}>
            {(control) => (
              <TextInput
                {...control}
                name={name("deadlineDays")}
                type="number"
                value={step.deadlineDays}
                onInput={(event) => onChange({ ...step, deadlineDays: Number(event.currentTarget.value) })}
              />
            )}
          </Field>
        </>
      )}
    </div>
  );
}
