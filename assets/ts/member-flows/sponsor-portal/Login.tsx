/**
 * Sponsor portal login screen — a self-service
 * "request a new link" form for POST /api/v1/auth/sponsor-portal/request-link.
 * Sponsors normally never see this screen at all: the first-ever visit
 * comes from clicking the `sponsor-portal-access` email's link, which
 * carries a `?token=` and is handled entirely by App.tsx before Login ever
 * renders. This screen only matters once that link's 72-hour session has
 * expired and the sponsor needs a fresh one.
 *
 * The event field accepts the event's public slug (e.g.
 * "pqc-conference-amsterdam-nl") — the only event identifier a sponsor
 * contact could plausibly know, resolved server-side against both
 * events.id and events.slug (see request-link's schema comment). Prefilled
 * from a `?event=` query param so a link like `/sponsor-portal/?event=<slug>`
 * (e.g. shared by staff, or linked from the event's own sponsor page) skips
 * retyping it.
 */
import { useState } from "preact/hooks";
import { postJson } from "../../shared/api-client";
import { MagicLinkSubmitButton, SignInError } from "../../components/MagicLinkFeedback";
import { useMagicLinkRequest } from "../../hooks/useMagicLinkRequest";
import { successResponseSchema } from "../../../shared/schemas/api-common";

function prefilledEvent(): string {
  return new URLSearchParams(window.location.search).get("event") ?? "";
}

export function Login() {
  const [email, setEmail] = useState("");
  const [eventSlug, setEventSlug] = useState(prefilledEvent);
  const magicLink = useMagicLinkRequest("Something went wrong. Please try again.");

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!email.trim() || !eventSlug.trim()) return;
    await magicLink.request(async () => {
      await postJson(
        "/api/v1/auth/sponsor-portal/request-link",
        { email: email.trim(), eventId: eventSlug.trim() },
        successResponseSchema,
      );
    });
  }

  return (
    <div class="d-flex justify-content-center py-5">
      <div class="card shadow-sm content-width-sm">
        <div class="card-body p-4">
          <h2 class="h4 mb-3">Sponsor Portal</h2>
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
