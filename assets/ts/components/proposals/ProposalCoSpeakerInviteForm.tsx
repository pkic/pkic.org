import { useState } from "preact/hooks";
import { coSpeakerInviteSchema, coSpeakerInviteResponseSchema } from "../../../shared/schemas/proposal-management";
import { PROPOSAL_SPEAKER_ROLES, type ProposalSpeakerRole } from "../../../shared/schemas/participant-roles";
import type { EventInviteWindow } from "../../../shared/schemas/event-invite-validity";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../shared/timezone";
import { postJson } from "../../shared/api-client";
import type { ToastType } from "../../shared/ui";
import { ErrorAlert } from "../ErrorAlert";
import { statusLabel } from "../Badge";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody } from "../../ui/Panel";
import { Select, TextInput } from "../../ui/TextControl";
import type { z } from "zod";

const INVITABLE_ROLES = PROPOSAL_SPEAKER_ROLES.filter(
  (role): role is Exclude<ProposalSpeakerRole, "proposer"> => role !== "proposer",
);

export function ProposalCoSpeakerInviteForm({
  endpoint,
  proposalId,
  event,
  notify,
  onInvited,
}: {
  endpoint: string;
  proposalId: string;
  event: EventInviteWindow;
  notify?: (message: string, type: ToastType) => void;
  onInvited: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Exclude<ProposalSpeakerRole, "proposer">>("speaker");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // A stable handle for the surrounding page; the controls' own ids belong to
  // the `Field`s that pair them with their labels.
  const formId = `proposal-${proposalId}-speaker-invite`;
  const latestExpiry = event.endsAt ? instantToDateTimeLocal(event.endsAt, event.timezone) : undefined;
  const deadlineHelp = `Leave blank to use the event start. A custom deadline cannot be later than the event end${
    latestExpiry ? ` (${latestExpiry.replace("T", " ")} ${event.timezone})` : ""
  }.`;

  async function submit(formEvent: Event): Promise<void> {
    formEvent.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: z.infer<typeof coSpeakerInviteSchema> = {
        email: email.trim().toLowerCase(),
        role,
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        ...(expiresAt ? { expiresAt: dateTimeLocalToIso(expiresAt, event.timezone) } : {}),
      };
      const invited = await postJson(endpoint, body, coSpeakerInviteResponseSchema);
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("speaker");
      setExpiresAt("");
      notify?.(
        invited.queued ? `Invitation queued for ${invited.email}` : `${invited.email} already has an active invitation`,
        "success",
      );
      await onInvited();
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error("Unable to invite the co-speaker.");
      setError(nextError);
      notify?.(nextError.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // The frame and padding the Bootstrap version drew by hand are the
    // panel's. The controls sit in a fieldset so the whole set goes out of
    // play in one attribute while the invitation is in flight, and its legend
    // names the group instead of a loose heading inside the form.
    <Panel>
      <PanelBody>
        <form id={formId} class="pk-stack" onSubmit={(event) => void submit(event)}>
          <fieldset class="pk-fieldset pk-stack" disabled={submitting}>
            <legend class="pk-strong">Invite a co-speaker</legend>
            <div class="pk-grid">
              <Field label="Email address" required>
                {(control) => (
                  <TextInput
                    {...control}
                    type="email"
                    autocomplete="email"
                    value={email}
                    onInput={(inputEvent) => setEmail((inputEvent.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label="First name">
                {(control) => (
                  <TextInput
                    {...control}
                    autocomplete="given-name"
                    value={firstName}
                    onInput={(inputEvent) => setFirstName((inputEvent.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label="Last name">
                {(control) => (
                  <TextInput
                    {...control}
                    autocomplete="family-name"
                    value={lastName}
                    onInput={(inputEvent) => setLastName((inputEvent.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label="Proposal role">
                {(control) => (
                  <Select
                    {...control}
                    value={role}
                    onChange={(changeEvent) =>
                      setRole(
                        (changeEvent.target as HTMLSelectElement).value as Exclude<ProposalSpeakerRole, "proposer">,
                      )
                    }
                  >
                    {INVITABLE_ROLES.map((option) => (
                      <option key={option} value={option}>
                        {statusLabel(option)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Invitation deadline" help={deadlineHelp}>
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={expiresAt}
                    max={latestExpiry}
                    onInput={(inputEvent) => setExpiresAt((inputEvent.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
            </div>
          </fieldset>
          <ErrorAlert error={error} />
          <div class="pk-cluster">
            {/* `loading` keeps the control focusable and says it is busy;
                `disabled` is what stops a second submit. */}
            <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
              {submitting ? "Queueing invitation…" : "Invite co-speaker"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
