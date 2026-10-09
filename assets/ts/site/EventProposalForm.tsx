import { Field } from "../ui/Field";
import { TextInput, Textarea } from "../ui/TextControl";
import { Checkbox } from "../ui/Checkbox";
import { Button } from "../ui/Button";
import { EventFlowProgress } from "./EventFlowProgress";

/** Published proposal controls enhanced by the canonical proposal controller. */
export function EventProposalForm() {
  return (
    <div class="event-flow pk" data-event-proposal data-api-base="/api/v1" data-module="event-flows/proposal-page">
      <EventFlowProgress label="Proposal progress" steps={["Terms", "Contact", "Proposal", "Speakers"]} />
      <form class="pk-form needs-validation" noValidate>
        <div data-step="1" class="event-flow-step is-active pk-stack">
          <p class="event-flow-step-intro">Before you begin, please review and accept the terms below.</p>
          <Field group label="Proposal terms" errorSlot="consents">
            {() => (
              <div data-consents>
                <p class="pk-muted pk-small">Loading…</p>
              </div>
            )}
          </Field>
        </div>
        <div data-step="2" class="event-flow-step pk-stack" hidden>
          <p class="event-flow-step-intro">
            Who should we contact about this proposal? Your details are used only for organizer communication and are
            kept confidential from the public.
          </p>
          <div data-proposer-identity />
        </div>
        <div data-step="3" class="event-flow-step pk-stack" hidden>
          <p class="event-flow-step-intro">
            Describe your session clearly so the review committee can assess its fit and impact.
          </p>
          <Field
            group
            label="Session type"
            errorSlot="proposal.type"
            help="This is your preferred format. The program committee may accept your session in a different form if it better fits the schedule or audience."
          >
            {() => <div data-session-types class="pk-cluster" />}
          </Field>
          <Field id="proposal-title" label="Title" errorSlot="proposal.title" required>
            {(control) => <TextInput {...control} name="title" required minLength={8} maxLength={180} />}
          </Field>
          <Field
            id="proposal-abstract"
            label="Abstract"
            errorSlot="proposal.abstract"
            help="Aim for 150–500 words. The committee values clarity, novelty, and practical applicability. Avoid promotional language and product names."
            required
          >
            {(control) => <Textarea {...control} name="abstract" rows={8} required minLength={80} maxLength={8000} />}
          </Field>
          <div data-custom-fields />
        </div>
        <div data-step="4" class="event-flow-step pk-stack" hidden>
          <p class="event-flow-step-intro">
            Each speaker receives a personal link by email to confirm their participation, complete their profile, and
            upload a headshot once the proposal is accepted.
          </p>
          <Checkbox
            id="proposal-is-presenting"
            name="isPresenting"
            label="I will also be presenting — add me as one of the speakers"
          />
          <div data-proposal-speakers class="pk-stack" />
          <Field group label="Speakers" errorSlot="speakers">
            {() => (
              <Button type="button" variant="secondary" size="sm" data-add-speaker>
                Add speaker
              </Button>
            )}
          </Field>
        </div>
        <div class="event-flow-step-nav">
          <Button type="button" variant="link" data-step-back hidden>
            ← Back
          </Button>
          <div class="event-flow-step-forward">
            <Button type="button" variant="primary" size="lg" data-step-next>
              Continue →
            </Button>
            <Button type="submit" variant="primary" size="lg" hidden>
              Submit proposal →
            </Button>
          </div>
        </div>
        <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
      </form>
    </div>
  );
}
