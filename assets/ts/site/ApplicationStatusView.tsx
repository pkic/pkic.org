import { Button } from "../ui/Button";

/** The application controller reads private status only from an emailed capability link. */
export function ApplicationStatusView() {
  return (
    <div
      class="pk pk-stack"
      data-application-status
      data-module="member-flows/application-status-page"
      data-api-base="/api/v1"
    >
      <p data-flow-status class="pk-alert pk-sr-only" role="alert" aria-live="polite" />
      <div data-link-help class="pk-stack pk-stack--snug">
        <p>
          Open the status link in your membership application confirmation or update email. It includes everything
          needed to view your application securely.
        </p>
        <p>
          If an older update email has an incomplete link, use your original confirmation email. If you cannot find it,{" "}
          <a href="/contact/">contact us for help</a>.
        </p>
      </div>
      <div class="pk-cluster" data-status-retry hidden>
        <Button type="button">Try again</Button>
      </div>
      <div data-status-result hidden>
        <p class="pk-small">Loading your application…</p>
      </div>
    </div>
  );
}
