import { Button } from "../ui/Button";

/** Token confirmation keeps its existing controller and native submit action. */
export function EventRegistrationConfirmation({ options = {} }: { options?: Record<string, string> }) {
  return (
    <div
      class="event-flow pk"
      data-event-registration-confirm
      data-module="event-flows/registration-confirm-page"
      data-api-base="/api/v1"
      data-success-title={options.successTitle}
      data-success-body={options.successBody}
      data-waitlist-title={options.waitlistTitle}
      data-waitlist-body={options.waitlistBody}
      data-partial-waitlist-title={options.partialWaitlistTitle}
      data-partial-waitlist-body={options.partialWaitlistBody}
      data-expired-title={options.expiredTitle}
      data-expired-body={options.expiredBody}
    >
      <div data-confirm-loading class="pk-stack pk-stack--snug" aria-hidden="true">
        <span class="pk-skeleton pk-skeleton--lg" />
        <span class="pk-skeleton" />
        <span class="pk-skeleton pk-skeleton--lg" />
      </div>
      <div data-confirm-content hidden>
        <p class="pk-lede">
          Hi <span data-placeholder="firstName">there</span>, you're one click away! Click the button below to verify
          your email address and confirm your registration for the{" "}
          <strong>
            <span data-placeholder="eventName">event</span>
          </strong>
          .
        </p>
        <form class="pk-stack needs-validation" noValidate>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" size="lg">
              Confirm my registration
            </Button>
          </div>
        </form>
      </div>
      <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" />
    </div>
  );
}
