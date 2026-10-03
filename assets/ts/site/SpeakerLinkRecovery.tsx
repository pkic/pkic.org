import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { Button } from "../ui/Button";

/** Shared controls for recovering the existing speaker management capability. */
export function SpeakerLinkRecovery() {
  return (
    <div data-resend-speaker-manage-section class="pk-stack" hidden>
      <p class="pk-muted pk-small">
        Enter the email address used for your speaker invitation and we'll send a fresh speaker management link.
      </p>
      <Field id="resend-speaker-manage-email" label="Your email address">
        {(control) => (
          <TextInput
            {...control}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            data-resend-speaker-manage-email
          />
        )}
      </Field>
      <div class="pk-cluster">
        <Button type="button" data-resend-speaker-manage-btn>
          Send my speaker link
        </Button>
      </div>
      <p data-resend-speaker-manage-status class="pk-small" />
    </div>
  );
}
