/**
 * Sponsor portal login screen (PRD §4.13, §11 UI-7) — a self-service
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
import { postJson, ApiClientError } from "../../shared/api-client";

function prefilledEvent(): string {
  return new URLSearchParams(window.location.search).get("event") ?? "";
}

export function Login() {
  const [email, setEmail] = useState("");
  const [eventSlug, setEventSlug] = useState(prefilledEvent);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!email.trim() || !eventSlug.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await postJson("/api/v1/auth/sponsor-portal/request-link", {
        email: email.trim(),
        eventId: eventSlug.trim(),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="d-flex justify-content-center py-5">
      <div class="card shadow-sm" style="max-width: 440px; width: 100%;">
        <div class="card-body p-4">
          <h2 class="h4 mb-3">Sponsor Portal</h2>
          <p class="text-muted">
            Access your event's attendee list with a sign-in link, sent to the contact email on file for your
            sponsorship.
          </p>
          {sent ? (
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
              <button type="submit" class="btn btn-success w-100" disabled={submitting}>
                {submitting ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}
          {error && <div class="alert alert-danger mt-3">✕ {error}</div>}
        </div>
      </div>
    </div>
  );
}
