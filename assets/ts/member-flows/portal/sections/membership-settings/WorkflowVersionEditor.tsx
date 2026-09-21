import { WorkflowRemoval } from "./WorkflowRemoval";
import { WorkflowReviewSummary } from "./WorkflowReviewSummary";
import { formatCurrencyAmount } from "../../../../../shared/format-currency";
import { useState } from "preact/hooks";
import {
  membershipWorkflowCreateSchema,
  membershipWorkflowUpdateSchema,
  membershipWorkflowPublishSchema,
  membershipWorkflowVersionResponseSchema,
  type MembershipWorkflowVersion,
  type MembershipWorkflowDefinition,
  type MembershipWorkflowStep,
} from "../../../../../shared/schemas/membership-workflows";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson, patchJson } from "../../../../shared/api-client";
import { MEMBERSHIP_WORKFLOWS_API } from "../../../../shared/membership-workflow-catalog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button, ButtonLink } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput, Textarea } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
import { WorkflowStepFields, newWorkflowStep } from "./WorkflowStepFields";

const path = "/settings/application-workflow";
function PublishVersion({
  version,
  onSaved,
}: {
  version: MembershipWorkflowVersion;
  onSaved: (version: MembershipWorkflowVersion) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(membershipWorkflowPublishSchema, { expectedRevision: version.revision, reason });
  async function publish(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    if (busy) return;
    setBusy(true);
    try {
      onSaved(
        (
          await postJson(
            `${MEMBERSHIP_WORKFLOWS_API}/${version.id}/publication`,
            checked.data,
            membershipWorkflowVersionResponseSchema,
          )
        ).workflow,
      );
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Publish this policy" />
      <PanelBody class="pk-stack">
        <p>
          Each step above is required, in order. Membership is granted only after every review and payment requirement
          is satisfied and no objection remains unresolved. Categories can select this version after publication.
          Applications already in progress keep their pinned version.
        </p>
        <form noValidate {...form.handlers} onSubmit={(event) => void publish(event)} class="pk-stack">
          <Field
            label="Policy adoption reason"
            {...form.of("reason")}
            required
            help="Record why this version is authorized for use."
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                value={reason}
                onInput={(event) => setReason(event.currentTarget.value)}
              />
            )}
          </Field>
          <ErrorAlert error={error} />
          <div>
            <Button type="submit" variant="primary" loading={busy}>
              Publish version {version.version}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}

export function WorkflowVersionEditor({
  initial,
  canWrite,
  canPublish,
  onSaved,
}: {
  initial?: MembershipWorkflowVersion;
  canWrite: boolean;
  canPublish: boolean;
  onSaved: (version: MembershipWorkflowVersion) => void;
}) {
  const [definition, setDefinition] = useState<MembershipWorkflowDefinition>(
    initial?.definition ?? { name: "", policyReference: "", steps: [newWorkflowStep("staff_review")] },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingStep, setEditingStep] = useState<number | null>(initial ? null : 0);
  const published = initial?.status === "published";
  const form = useContractForm(initial ? membershipWorkflowUpdateSchema : membershipWorkflowCreateSchema, {
    definition,
    ...(initial ? { expectedRevision: initial.revision } : {}),
  });
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    if (busy || !canWrite || published) return;
    setBusy(true);
    try {
      const result = initial
        ? await patchJson(
            `${MEMBERSHIP_WORKFLOWS_API}/${initial.id}`,
            checked.data,
            membershipWorkflowVersionResponseSchema,
          )
        : await postJson(MEMBERSHIP_WORKFLOWS_API, checked.data, membershipWorkflowVersionResponseSchema);
      onSaved(result.workflow);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  async function clone() {
    if (!initial || busy) return;
    setBusy(true);
    try {
      onSaved(
        (
          await postJson(
            MEMBERSHIP_WORKFLOWS_API,
            membershipWorkflowCreateSchema.parse({ definition: initial.definition, sourceVersionId: initial.id }),
            membershipWorkflowVersionResponseSchema,
          )
        ).workflow,
      );
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  function move(position: number, delta: number) {
    const steps = [...definition.steps];
    [steps[position], steps[position + delta]] = [steps[position + delta], steps[position]];
    setDefinition({ ...definition, steps });
    setEditingStep(null);
  }
  function add(kind: MembershipWorkflowStep["kind"]) {
    setDefinition({ ...definition, steps: [...definition.steps, newWorkflowStep(kind)] });
    setEditingStep(definition.steps.length);
  }
  const title = initial ? `${initial.definition.name} · version ${initial.version}` : "New membership workflow";
  return (
    <div class="pk pk-stack">
      <PageHeader
        title={title}
        trail={[
          { label: "Settings", href: usePortalHashLocation.hrefs("/settings") },
          { label: "Application workflows", href: usePortalHashLocation.hrefs(path) },
          { label: title },
        ]}
      />
      {published && (
        <p>This published version is immutable. Create a new draft to change the policy for future applications.</p>
      )}
      <form noValidate {...form.handlers} onSubmit={(event) => void save(event)} class="pk-stack">
        <Panel>
          <PanelHeader title="Workflow policy" />
          <PanelBody class="pk-stack">
            <fieldset class="pk-fieldset pk-stack" disabled={!canWrite || busy || published}>
              <Field label="Workflow name" {...form.of("definition.name")} required>
                {(control) => (
                  <TextInput
                    {...control}
                    name="definition.name"
                    value={definition.name}
                    onInput={(event) => setDefinition({ ...definition, name: event.currentTarget.value })}
                  />
                )}
              </Field>
              <Field
                label="Policy reference"
                {...form.of("definition.policyReference")}
                required
                help="Name or link the adopted policy, such as the admission rules in the bylaws."
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="definition.policyReference"
                    value={definition.policyReference}
                    onInput={(event) => setDefinition({ ...definition, policyReference: event.currentTarget.value })}
                  />
                )}
              </Field>
            </fieldset>
          </PanelBody>
        </Panel>
        {definition.steps.map((step, position) => (
          <Panel key={step.id}>
            <PanelHeader title={`${position + 1}. ${step.label || "New step"}`} />
            <PanelBody class="pk-stack">
              <p>
                {step.kind === "staff_review"
                  ? "An eligible reviewer must record a decision with a reason."
                  : step.kind === "consensus"
                    ? `The response window lasts ${step.durationDays} days after the notice is sent. ${step.objectionHandling === "hold_for_resolution" ? "Objections must be resolved before continuing." : "Objections are referred to the following review and still block final approval."}`
                    : `Verified payment of ${formatCurrencyAmount(step.amount, step.currency)} is required within ${step.deadlineDays} days.`}
              </p>
              <WorkflowReviewSummary step={step} />
              {step.instructions && <p>{step.instructions}</p>}
              {form.errorsWithin(`definition.steps.${position}`).length > 0 && (
                <ErrorAlert
                  error={`Step ${position + 1} needs attention: ${form.errorsWithin(`definition.steps.${position}`).join(" ")}`}
                />
              )}
              {(published ||
                editingStep === position ||
                form.errorsWithin(`definition.steps.${position}`).length > 0) && (
                <fieldset
                  class="pk-fieldset"
                  disabled={!canWrite || busy || published}
                  onFocusIn={() => setEditingStep(position)}
                >
                  <WorkflowStepFields
                    step={step}
                    position={position}
                    of={form.of}
                    onChange={(updated) =>
                      setDefinition({
                        ...definition,
                        steps: definition.steps.map((item, index) => (index === position ? updated : item)),
                      })
                    }
                  />
                </fieldset>
              )}
              {!published && canWrite && (
                <div class="pk-cluster">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setEditingStep(editingStep === position ? null : position)}
                  >
                    {editingStep === position ? "Done editing" : "Edit step"}
                  </Button>
                  <Button type="button" size="sm" disabled={position === 0} onClick={() => move(position, -1)}>
                    Move up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={position === definition.steps.length - 1}
                    onClick={() => move(position, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger-quiet"
                    onClick={() =>
                      setDefinition({ ...definition, steps: definition.steps.filter((_, index) => index !== position) })
                    }
                  >
                    Remove step
                  </Button>
                </div>
              )}
            </PanelBody>
          </Panel>
        ))}
        {!published && canWrite && (
          <div class="pk-cluster">
            <Button type="button" disabled={definition.steps.length >= 8} onClick={() => add("staff_review")}>
              Add staff review
            </Button>
            <Button type="button" disabled={definition.steps.length >= 8} onClick={() => add("consensus")}>
              Add consensus review
            </Button>
            <Button type="button" disabled={definition.steps.length >= 8} onClick={() => add("payment")}>
              Add payment confirmation
            </Button>
          </div>
        )}
        <ErrorAlert error={error} />
        <div class="pk-cluster">
          {canWrite &&
            (published ? (
              <Button type="button" variant="primary" loading={busy} onClick={() => void clone()}>
                Create new draft
              </Button>
            ) : (
              <Button type="submit" variant="primary" loading={busy}>
                Save draft
              </Button>
            ))}
          <ButtonLink href={usePortalHashLocation.hrefs(path)}>Back to workflows</ButtonLink>
        </div>
      </form>
      {initial && canWrite && <WorkflowRemoval version={initial} />}
      {initial &&
        !published &&
        canWrite &&
        canPublish &&
        JSON.stringify(definition) === JSON.stringify(initial.definition) && (
          <PublishVersion version={initial} onSaved={onSaved} />
        )}
    </div>
  );
}
