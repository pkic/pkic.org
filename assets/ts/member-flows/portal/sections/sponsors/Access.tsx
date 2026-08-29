/** Request access to the sponsor workspace within the unified portal. */
import { useState } from "preact/hooks";
import { postJson } from "../../../../shared/api-client";
import { MagicLinkSubmitButton, SignInError } from "../../../../components/MagicLinkFeedback";
import { useMagicLinkRequest } from "../../../../hooks/useMagicLinkRequest";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";

function prefilledEvent(): string {
  const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?", 2)[1] : "";
  return new URLSearchParams(hashQuery).get("event") ?? "";
}

export function SponsorAccess() {
  const [email, setEmail] = useState("");
  const [eventSlug, setEventSlug] = useState(prefilledEvent);
  const magicLink = useMagicLinkRequest("Something went wrong. Please try again.");

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!email.trim() || !eventSlug.trim()) return;
    await magicLink.request(async () => {
      await postJson(
        "/api/v1/sponsors/access-links",
        { email: email.trim(), eventSlug: eventSlug.trim() },
        successResponseSchema,
      );
    });
  }

  return (
    <div class="d-flex justify-content-center py-5">
      <div class="card shadow-sm content-width-sm">
        <div class="card-body p-4">
          <h2 class="h4 mb-3">Sponsor access</h2>
          <p class="text-muted">
            Access your event's attendee list with a sign-in link, sent to the contact email on file for your
            sponsorship.
          </p>
          {magicLink.sent ? (
            <div class="alert alert-success mt-3">
              ✓ If this matches an active event sponsorship, you'll receive a sign-in link shortly.
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <div class="mb-3">
                <label class="form-label fw-semibold" for="sp-inp-email">
                  Email
                </label>
                <input
                  class="form-control"
                  type="email"
                  id="sp-inp-email"
                  required
                  autocomplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="mb-3">
                <label class="form-label fw-semibold" for="sp-inp-event">
                  Event
                </label>
                <input
                  class="form-control"
                  type="text"
                  id="sp-inp-event"
                  required
                  placeholder="e.g. pqc-conference-amsterdam-nl"
                  value={eventSlug}
                  onInput={(e) => setEventSlug((e.target as HTMLInputElement).value)}
                />
                <div class="form-text">
                  The event's web address slug — found in your original sponsor invitation email, or ask your PKIC
                  contact.
                </div>
              </div>
              <MagicLinkSubmitButton submitting={magicLink.submitting} />
            </form>
          )}
          <SignInError error={magicLink.error} includePrefix={false} />
        </div>
      </div>
    </div>
  );
}
