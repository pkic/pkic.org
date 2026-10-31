import { useContractForm } from "../../../../hooks/useContractForm";
import { Alert } from "../../../../ui/Alert";
import { applicationStageTransitionSchema } from "../../../../../shared/schemas/membership-application-management";
import { useState } from "preact/hooks";
import {
  ON_HOLD_SUBTYPES,
  allowedTransitions,
  type ApplicationStage,
} from "../../../../../shared/schemas/member-applications";
import type {
  ApplicationStageTransition,
  MembershipApplicationDetail,
} from "../../../../../shared/schemas/membership-application-management";
import { statusLabel } from "../../../../components/Badge";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput, Textarea } from "../../../../ui/TextControl";

/**
 * Where staff move a membership application next.
 *
 * The three controls used to be bare `<label>`s beside their inputs with no
 * `for` at all, so nothing announced which select was "Move to" and which was
 * the on-hold reason. They are `Field`s now, which is what puts the `for`/`id`
 * pair and the `aria-describedby` into the markup rather than into a comment.
 */
export function ApplicationTransitionCard({
  detail,
  canWrite,
  onTransition,
}: {
  detail: MembershipApplicationDetail;
  canWrite: boolean;
  onTransition: (params: ApplicationStageTransition) => Promise<void>;
}) {
  const [transitioning, setTransitioning] = useState(false);
  const [toStage, setToStage] = useState("");
  const [onHoldSubtype, setOnHoldSubtype] = useState<string>(ON_HOLD_SUBTYPES[0]);
  const [requestDetails, setRequestDetails] = useState("");
  const [transitionNote, setTransitionNote] = useState("");

  const [error, setError] = useState("");
  const form = useContractForm(applicationStageTransitionSchema, {
    toStage,
    onHoldSubtype: toStage === "on_hold" ? onHoldSubtype : undefined,
    note: transitionNote,
    requestDetails:
      toStage === "declined" || (toStage === "on_hold" && onHoldSubtype === "request_information")
        ? requestDetails
        : undefined,
  });
  const availableTransitions = allowedTransitions(detail.stage as ApplicationStage) ?? [];

  async function submitTransition(e: Event) {
    e.preventDefault();
    if (transitioning) return;
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setTransitioning(true);
    try {
      await onTransition(checked.data);
      form.reset();
      setToStage("");
      setTransitionNote("");
      setRequestDetails("");
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setTransitioning(false);
    }
  }

  return (
    // The panel names itself: the detail view stacks several of these, and an
    // unnamed <section> is announced as nothing at all.
    <Panel class="pk" aria-label="Stage transition">
      <PanelHeader title="Stage transition" />
      <PanelBody class="pk-stack pk-stack--snug">
        {!canWrite ? null : availableTransitions.length === 0 ? (
          <p class="pk-muted pk-small">No further transitions from this stage.</p>
        ) : (
          <form
            noValidate
            {...form.handlers}
            class="pk-stack pk-stack--snug"
            onSubmit={(event) => void submitTransition(event)}
          >
            {/* One `disabled` on the group takes every control out of play
                while the transition is in flight, rather than one prop each. */}
            <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={transitioning}>
              <Field label="Move to" required {...form.of("toStage")}>
                {(control) => (
                  <Select
                    {...control}
                    name="toStage"
                    value={toStage}
                    onChange={(event) => setToStage((event.target as HTMLSelectElement).value)}
                  >
                    <option value="">Select…</option>
                    {availableTransitions.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {toStage === "on_hold" && (
                <Field
                  {...form.of("onHoldSubtype")}
                  label="Reason"
                  required
                  help="Why the application is being paused."
                >
                  {(control) => (
                    <Select
                      {...control}
                      name="onHoldSubtype"
                      value={onHoldSubtype}
                      onChange={(event) => setOnHoldSubtype((event.target as HTMLSelectElement).value)}
                    >
                      {ON_HOLD_SUBTYPES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {(toStage === "declined" || (toStage === "on_hold" && onHoldSubtype === "request_information")) && (
                <Field
                  {...form.of("requestDetails")}
                  label={toStage === "declined" ? "Reason for declining" : "Information requested"}
                  required={toStage === "on_hold"}
                  help={
                    toStage === "declined"
                      ? "Optional. Included in the email to the applicant."
                      : "Included in the email to the applicant. Describe what they need to provide."
                  }
                >
                  {(control) => (
                    <Textarea
                      {...control}
                      name="requestDetails"
                      value={requestDetails}
                      onInput={(event) => setRequestDetails(event.currentTarget.value)}
                    />
                  )}
                </Field>
              )}
              <Field
                {...form.of("note")}
                label="Internal note"
                help="Optional. Recorded in the application history for staff."
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="note"
                    value={transitionNote}
                    onInput={(event) => setTransitionNote((event.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
            </fieldset>
            {error && <Alert tone="danger">{error}</Alert>}
            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={transitioning}>
                Transition
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
