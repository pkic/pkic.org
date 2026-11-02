import { PROPOSAL_SPEAKER_ROLES } from "../../shared/schemas/participant-roles";
import { statusLabel } from "../../shared/status-display";
import { Field } from "../ui/Field";
import { Select, TextInput, Textarea } from "../ui/TextControl";
import { Button } from "../ui/Button";
import { HeadshotDialogTemplates } from "./HeadshotDialogTemplates";
import { PROPOSAL_COMMITTEE_NOTES_COPY } from "../../shared/proposal-committee-notes-copy";

/** Token-dependent content is populated by the existing proposal controller. */
export function EventProposalManagement() {
  return (
    <div
      class="event-flow pk"
      data-event-proposal-manage
      data-api-base="/api/v1"
      data-module="event-flows/proposal-manage-page"
    >
      <p class="pk-muted" data-proposal-manage-loading>
        Loading proposal…
      </p>
      <div class="pk-stack pk-stack--loose" hidden data-proposal-manage-content>
        <p class="pk-muted pk-small">Return here any time with the link from your proposal email.</p>
        <form class="pk-form needs-validation" noValidate>
          <Field id="manage-proposal-type" label="Session type" errorSlot="proposalType" required>
            {(control) => <Select {...control} name="proposalType" required />}
          </Field>
          <Field id="manage-proposal-title" label="Title" errorSlot="title" required>
            {(control) => <TextInput {...control} name="title" required />}
          </Field>
          <Field id="manage-proposal-abstract" label="Abstract" errorSlot="abstract" required>
            {(control) => <Textarea {...control} name="abstract" rows={8} required />}
          </Field>
          <Field
            id="manage-proposal-committee-notes"
            label={PROPOSAL_COMMITTEE_NOTES_COPY.label}
            errorSlot="committeeNotes"
            help={PROPOSAL_COMMITTEE_NOTES_COPY.help}
          >
            {(control) => <Textarea {...control} name="committeeNotes" rows={4} maxLength={4000} />}
          </Field>
          <p class="pk-small pk-muted" data-committee-notes-locked hidden>
            {PROPOSAL_COMMITTEE_NOTES_COPY.locked}
          </p>
          <div class="pk-cluster">
            <Button type="submit">Save changes</Button>
            <Button type="button" variant="danger-quiet" data-action="withdraw">
              Withdraw proposal
            </Button>
          </div>
          <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
        </form>
        <div data-cospeaker-section class="pk-stack">
          <h3>Speakers</h3>
          <p class="pk-small">
            Invite the other speakers for this proposal. Each speaker confirms through the link we email them and keeps
            their own bio, links, and photo current there.
          </p>
          <div data-cospeaker-list class="pk-stack" />
          <p class="pk-small" data-cospeaker-status-help>
            Track who has accepted, and send a reminder to invited speakers who have not responded yet.
          </p>
          <div data-cospeaker-form class="pk-stack">
            <div class="pk-grid pk-grid--tight">
              <Field id="cs-email" label="Email" required>
                {(control) => (
                  <TextInput
                    {...control}
                    name="cs-email"
                    type="email"
                    placeholder="speaker@example.com"
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field id="cs-first-name" label="First name">
                {(control) => <TextInput {...control} name="cs-first-name" placeholder="Optional" />}
              </Field>
              <Field id="cs-last-name" label="Last name">
                {(control) => <TextInput {...control} name="cs-last-name" placeholder="Optional" />}
              </Field>
              <Field id="cs-role" label="Role">
                {(control) => (
                  <Select {...control} name="cs-role">
                    {PROPOSAL_SPEAKER_ROLES.filter((role) => role !== "proposer").map((role) => (
                      <option value={role} key={role}>
                        {statusLabel(role)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div class="pk-cluster">
              <Button type="button" variant="secondary" data-cospeaker-invite-btn>
                Send invite
              </Button>
            </div>
            <p data-cospeaker-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
          </div>
        </div>
      </div>
      <div class="pk-stack" hidden data-resend-proposal-manage-section>
        <p>Enter the email address used to submit your proposal and we will send fresh management links.</p>
        <Field id="resend-proposal-manage-email" label="Your email address">
          {(control) => (
            <TextInput
              {...control}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              data-resend-proposal-manage-email
            />
          )}
        </Field>
        <Button type="button" data-resend-proposal-manage-btn>
          Send my proposal links
        </Button>
        <p data-resend-proposal-manage-status class="pk-small" role="status" />
      </div>
      <HeadshotDialogTemplates />
    </div>
  );
}
