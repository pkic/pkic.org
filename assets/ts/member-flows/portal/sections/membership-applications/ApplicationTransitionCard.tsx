import { useContractForm } from "../../../../hooks/useContractForm";
import { Alert } from "../../../../ui/Alert";
import { applicationStageTransitionSchema } from "../../../../../shared/schemas/membership-application-management";
import { useState } from "preact/hooks";
import {
  ON_HOLD_SUBTYPES,
  allowedTransitions,
  type ApplicationStage,
} from "../../../../../shared/schemas/member-applications";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { statusLabel } from "../../../../components/Badge";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";

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
  onTransition: (params: { toStage: string; onHoldSubtype?: string; note?: string }) => Promise<void>;
}) {
  const [transitioning, setTransitioning] = useState(false);
  const [toStage, setToStage] = useState("");
  const [onHoldSubtype, setOnHoldSubtype] = useState<string>(ON_HOLD_SUBTYPES[0]);
  const [transitionNote, setTransitionNote] = useState("");

  const [error, setError] = useState("");
  const form = useContractForm(applicationStageTransitionSchema, {
    toStage,
    onHoldSubtype: toStage === "on_hold" ? onHoldSubtype : undefined,
    note: transitionNote,
  });
  const availableTransitions = allowedTransitions(detail.stage as ApplicationStage) ?? [];

  async function submitTransition(e: Event) {
    e.preventDefault();
    if (transitioning) return;
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setTransitioning(true);
    try {
      await onTransition(checked.data);
      form.reset();
      setToStage("");
      setTransitionNote("");
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
              {/* "(optional)" was part of the visible label, which made the
                  announced name of the control "Note (optional)". The word
                  belongs in the help text the label points at instead. */}
              <Field
                {...form.of("note")}
                label="Note"
                help="Optional. Recorded on the stage change for whoever reads it next."
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
              <Button type="submit" size="sm" variant="primary" loading={transitioning}>
                Transition
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
