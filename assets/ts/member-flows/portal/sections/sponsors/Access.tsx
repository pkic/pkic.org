/**
 * Request access to the sponsor workspace within the unified portal.
 *
 * Built on the same shape as the portal's own sign-in screen: it is the whole
 * page while nobody is signed in, so it carries its own `.pk` root, and both
 * controls are `Field`s that own their `for`/`id` pair and their required
 * annotation instead of hand-written ids. The confirmation is an `Alert`
 * rather than a green box opening with a bare "✓", which a screen reader
 * reads out as a character and which was the only thing besides the colour
 * saying the send had worked.
 */
import { useState } from "preact/hooks";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { MagicLinkSubmitButton, SignInError } from "../../../../components/MagicLinkFeedback";
import { useMagicLinkRequest } from "../../../../hooks/useMagicLinkRequest";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { sponsorAccessLinkRequestSchema } from "../../../../../shared/schemas/sponsor-access";
import { Alert } from "../../../../ui/Alert";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";

function prefilledEvent(): string {
  const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?", 2)[1] : "";
  return new URLSearchParams(hashQuery).get("event") ?? "";
}

export function SponsorAccess() {
  const [email, setEmail] = useState("");
  const [eventSlug, setEventSlug] = useState(prefilledEvent);
  const magicLink = useMagicLinkRequest("Something went wrong. Please try again.");

  /*
   * One basis for validation: the contract the route parses. The form used to
   * check `if (!email.trim() || !eventSlug.trim()) return`, which silently did
   * nothing — a reader who left a field blank got no message and no marked
   * field, only a button that appeared not to work.
   */
  const form = useContractForm(sponsorAccessLinkRequestSchema, {
    email: email.trim(),
    eventSlug: eventSlug.trim(),
  });

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const checked = form.submit();
    if (!checked.data) return;
    await magicLink.request(async () => {
      await postJson("/api/v1/sponsors/access-links", checked.data, successResponseSchema);
    });
  }

  return (
    <div class="pk pk-container pk-section pk-cluster pk-cluster--center">
      <Panel class="content-width-sm">
        <PanelHeader title="Sponsor access" headingLevel={2} />
        <PanelBody class="pk-stack">
          <p class="pk-muted">
            Access your event&apos;s attendee list with a sign-in link, sent to the contact email on file for your
            sponsorship.
          </p>
          {magicLink.sent ? (
            <Alert tone="ok">
              If this matches an active event sponsorship, you&apos;ll receive a sign-in link shortly.
            </Alert>
          ) : (
            <form
              noValidate
              class="pk-stack"
              {...form.handlers}
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <Field label="Email" required {...form.of("email")}>
                {(control) => (
                  <TextInput
                    {...control}
                    type="email"
                    name="email"
                    autocomplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field
                label="Event"
                required
                help="The event's web address slug — found in your original sponsor invitation email, or ask your PKI Consortium contact."
                {...form.of("eventSlug")}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    type="text"
                    name="eventSlug"
                    placeholder="e.g. pqc-conference-amsterdam-nl"
                    value={eventSlug}
                    onInput={(e) => setEventSlug((e.target as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <MagicLinkSubmitButton submitting={magicLink.submitting} />
            </form>
          )}
          <SignInError error={magicLink.error} includePrefix={false} />
        </PanelBody>
      </Panel>
    </div>
  );
}
