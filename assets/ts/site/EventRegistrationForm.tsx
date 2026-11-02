/** Public host for the shared create/update registration flow. */
export function EventRegistrationForm() {
  return (
    <div
      class="event-flow pk"
      data-event-registration
      data-api-base="/api/v1"
      data-module="event-flows/registration-page"
    >
      <div data-registration-flow-mount>
        <p role="status">Loading registration…</p>
      </div>
    </div>
  );
}
