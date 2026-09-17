/**
 * Inviting a co-speaker: a page of its own under the proposal's Speakers
 * facet.
 *
 * A person the portal already knows is found through the shared user picker
 * and their details come along; somebody new is invited by address. Either
 * way the invitation goes to the same canonical contract — the picker only
 * spares the operator retyping what the portal holds.
 */
import { useState } from "preact/hooks";
import { coSpeakerInviteSchema, coSpeakerInviteResponseSchema } from "../../../shared/schemas/proposal-management";
import { PROPOSAL_SPEAKER_ROLES, type ProposalSpeakerRole } from "../../../shared/schemas/participant-roles";
import type { EventInviteWindow } from "../../../shared/schemas/event-invite-validity";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../shared/timezone";
import { useContractForm } from "../../hooks/useContractForm";
import { postJson } from "../../shared/api-client";
import type { ToastType } from "../../shared/ui";
import { statusLabel } from "../Badge";
import { UserPicker, type PickedUser } from "../UserPicker";
import { Alert } from "../../ui/Alert";
import { Button, ButtonLink } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { FormSection } from "../../ui/FormSection";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Select, TextInput } from "../../ui/TextControl";

const INVITABLE_ROLES = PROPOSAL_SPEAKER_ROLES.filter(
  (role): role is Exclude<ProposalSpeakerRole, "proposer"> => role !== "proposer",
);

export function ProposalCoSpeakerInviteForm({
  endpoint,
  event,
  notify,
  onInvited,
  cancelHref,
}: {
  endpoint: string;
  event: EventInviteWindow;
  notify?: (message: string, type: ToastType) => void;
  onInvited: () => void | Promise<void>;
  /** The way back to the roster, when the form is a page under it. */
  cancelHref?: string;
}) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Exclude<ProposalSpeakerRole, "proposer">>("speaker");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const latestExpiry = event.endsAt ? instantToDateTimeLocal(event.endsAt, event.timezone) : undefined;
  // One basis for validation: the invitation contract the route parses checks
  // the draft as it is typed and is the only thing that may refuse it.
  const form = useContractForm(coSpeakerInviteSchema, {
    email: email.trim().toLowerCase(),
    role,
    ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
    ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
    ...(expiresAt ? { expiresAt: dateTimeLocalToIso(expiresAt, event.timezone) } : {}),
  });

  function pickUser(user: PickedUser | null): void {
    setPicked(user);
    if (!user) return;
    // The picked person's details are the draft; the fields stay editable in
    // case the roster should read differently from the account.
    setEmail(user.email);
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
  }

  async function submit(formEvent: Event): Promise<void> {
    formEvent.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const invited = await postJson(endpoint, checked.data, coSpeakerInviteResponseSchema);
      notify?.(
        invited.queued ? `Invitation queued for ${invited.email}` : `${invited.email} already has an active invitation`,
        "success",
      );
      await onInvited();
    } catch (cause) {
      // A refusal that names the field lands on the control; the rest is
      // stated beside the form.
      const message = form.refuse(cause);
      setError(message);
      notify?.(message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel aria-label="Invite a co-speaker">
      <PanelHeader title="Invite a co-speaker" breadcrumb />
      <PanelBody>
        <form class="pk-stack" noValidate {...form.handlers} onSubmit={(event) => void submit(event)}>
          <fieldset class="pk-fieldset pk-stack" disabled={submitting}>
            <FormSection
              title="Who"
              description="Find someone the portal already knows, or invite a new person by address."
            >
              <Field label="Existing user" help="Search by name or email; their details fill in below.">
                {(control) => <UserPicker value={picked} onChange={pickUser} inputProps={control} />}
              </Field>
              <div class="pk-grid pk-grid--tight">
                <Field label="Email address" required {...form.of("email")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="email"
                      type="email"
                      autocomplete="email"
                      value={email}
                      onInput={(inputEvent) => setEmail((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="First name" {...form.of("firstName")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="firstName"
                      autocomplete="given-name"
                      value={firstName}
                      onInput={(inputEvent) => setFirstName((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Last name" {...form.of("lastName")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="lastName"
                      autocomplete="family-name"
                      value={lastName}
                      onInput={(inputEvent) => setLastName((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </div>
            </FormSection>
            <FormSection title="Invitation">
              <div class="pk-grid pk-grid--tight">
                <Field label="Proposal role" {...form.of("role")}>
                  {(control) => (
                    <Select
                      {...control}
                      name="role"
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
                <Field
                  label="Invitation deadline"
                  help={`Leave blank to use the event start. A custom deadline cannot be later than the event end${
                    latestExpiry ? ` (${latestExpiry.replace("T", " ")} ${event.timezone})` : ""
                  }.`}
                  {...form.of("expiresAt")}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="expiresAt"
                      type="datetime-local"
                      value={expiresAt}
                      max={latestExpiry}
                      onInput={(inputEvent) => setExpiresAt((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </div>
            </FormSection>
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
          <div class="pk-cluster">
            {/* `loading` keeps the control focusable and says it is busy;
                `disabled` is what stops a second submit. */}
            <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
              {submitting ? "Queueing invitation…" : "Invite co-speaker"}
            </Button>
            {cancelHref && (
              <ButtonLink href={cancelHref} variant="ghost">
                Cancel
              </ButtonLink>
            )}
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
