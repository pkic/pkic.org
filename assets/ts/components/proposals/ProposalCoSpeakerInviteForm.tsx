import { useState } from "preact/hooks";
import { coSpeakerInviteSchema, coSpeakerInviteResponseSchema } from "../../../shared/schemas/proposal-management";
import { PROPOSAL_SPEAKER_ROLES, type ProposalSpeakerRole } from "../../../shared/schemas/participant-roles";
import type { EventInviteWindow } from "../../../shared/schemas/event-invite-validity";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../shared/timezone";
import { postJson } from "../../shared/api-client";
import { formatStatusLabel } from "../../shared/form/helpers";
import type { ToastType } from "../../shared/ui";
import { ErrorAlert } from "../ErrorAlert";
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
  const fieldPrefix = `proposal-${proposalId}-speaker-invite`;
  const latestExpiry = event.endsAt ? instantToDateTimeLocal(event.endsAt, event.timezone) : undefined;

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
    <form class="border rounded p-3 mb-3" onSubmit={(event) => void submit(event)}>
      <h6>Invite a co-speaker</h6>
      <div class="row g-2">
        <div class="col-12 col-lg-5">
          <label class="form-label" for={`${fieldPrefix}-email`}>
            Email address
          </label>
          <input
            id={`${fieldPrefix}-email`}
            class="form-control"
            type="email"
            autocomplete="email"
            required
            value={email}
            onInput={(inputEvent) => setEmail((inputEvent.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-6 col-lg-3">
          <label class="form-label" for={`${fieldPrefix}-first-name`}>
            First name
          </label>
          <input
            id={`${fieldPrefix}-first-name`}
            class="form-control"
            autocomplete="given-name"
            value={firstName}
            onInput={(inputEvent) => setFirstName((inputEvent.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-6 col-lg-4">
          <label class="form-label" for={`${fieldPrefix}-last-name`}>
            Last name
          </label>
          <input
            id={`${fieldPrefix}-last-name`}
            class="form-control"
            autocomplete="family-name"
            value={lastName}
            onInput={(inputEvent) => setLastName((inputEvent.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label" for={`${fieldPrefix}-role`}>
            Proposal role
          </label>
          <select
            id={`${fieldPrefix}-role`}
            class="form-select"
            value={role}
            onChange={(changeEvent) =>
              setRole((changeEvent.target as HTMLSelectElement).value as Exclude<ProposalSpeakerRole, "proposer">)
            }
          >
            {INVITABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {formatStatusLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <div class="col-12 col-md-8">
          <label class="form-label" for={`${fieldPrefix}-expires-at`}>
            Invitation deadline
          </label>
          <input
            id={`${fieldPrefix}-expires-at`}
            class="form-control"
            type="datetime-local"
            value={expiresAt}
            max={latestExpiry}
            onInput={(inputEvent) => setExpiresAt((inputEvent.target as HTMLInputElement).value)}
          />
          <div class="form-text">
            Leave blank to use the event start. A custom deadline cannot be later than the event end
            {latestExpiry ? ` (${latestExpiry.replace("T", " ")} ${event.timezone})` : ""}.
          </div>
        </div>
      </div>
      <ErrorAlert error={error} />
      <button type="submit" class="btn btn-primary mt-3" disabled={submitting}>
        {submitting ? "Queueing invitation…" : "Invite co-speaker"}
      </button>
    </form>
  );
}
