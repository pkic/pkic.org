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
  canApprove,
  onApprove,
  onTransition,
}: {
  detail: MembershipApplicationDetail;
  canWrite: boolean;
  canApprove: boolean;
  onApprove: () => Promise<void>;
  onTransition: (params: { toStage: string; onHoldSubtype?: string; note?: string }) => Promise<void>;
}) {
  const [transitioning, setTransitioning] = useState(false);
  const [toStage, setToStage] = useState("");
  const [onHoldSubtype, setOnHoldSubtype] = useState<string>(ON_HOLD_SUBTYPES[0]);
  const [transitionNote, setTransitionNote] = useState("");

  const availableTransitions = allowedTransitions(detail.stage as ApplicationStage) ?? [];

  async function submitTransition(e: Event) {
    e.preventDefault();
    // `loading` keeps the submit button focusable rather than disabling it, so
    // the guard against a second submission lives here instead of in the
    // markup: a disabled control loses focus, which throws a screen-reader
    // user out of the form they were in the middle of.
    if (transitioning || !toStage) return;
    setTransitioning(true);
    try {
      await onTransition({ toStage, onHoldSubtype, note: transitionNote });
      setToStage("");
      setTransitionNote("");
    } catch {
      // The caller owns reporting a refused transition — it is the one holding
      // the request — so this only has to keep the reader's work: the stage and
      // the note stay as typed, ready to retry. Without the catch the rejection
      // escaped as an unhandled promise and the card said nothing at all.
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
        {canApprove && detail.stage === "ec_review" && (
          <div class="pk-cluster">
            {/* Bootstrap's `success` and `primary` were two fills for one
                thing — the card's affirmative action — so both resolve to the
                system's single primary variant. */}
            <Button size="sm" variant="primary" onClick={() => void onApprove()}>
              Approve &amp; run onboarding
            </Button>
          </div>
        )}
        {!canWrite ? null : availableTransitions.length === 0 ? (
          <p class="pk-muted pk-small">No further transitions from this stage.</p>
        ) : (
          <form class="pk-stack pk-stack--snug" onSubmit={(event) => void submitTransition(event)}>
            {/* One `disabled` on the group takes every control out of play
                while the transition is in flight, rather than one prop each. */}
            <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={transitioning}>
              <Field label="Move to" required>
                {(control) => (
                  <Select
                    {...control}
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
                <Field label="Reason" required help="Why the application is being paused.">
                  {(control) => (
                    <Select
                      {...control}
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
              <Field label="Note" help="Optional. Recorded on the stage change for whoever reads it next.">
                {(control) => (
                  <TextInput
                    {...control}
                    value={transitionNote}
                    onInput={(event) => setTransitionNote((event.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
            </fieldset>
            <div class="pk-cluster">
              <Button type="submit" size="sm" variant="primary" loading={transitioning} disabled={!toStage}>
                Transition
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
