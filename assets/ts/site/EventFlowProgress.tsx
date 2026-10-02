/** Shared static progress markup for the existing event form controllers. */
export function EventFlowProgress({ label, steps }: { label: string; steps: string[] }) {
  return (
    <nav class="event-flow-stepper" aria-label={label}>
      <div class="event-flow-stepper-track" aria-hidden="true">
        <div class="event-flow-stepper-fill" data-step-fill />
      </div>
      <ol class="event-flow-stepper-list">
        {steps.map((step, index) => (
          <li
            class={`event-flow-stepper-item${index === 0 ? " is-active" : ""}`}
            data-step-item={index + 1}
            aria-current={index === 0 ? "step" : undefined}
            key={step}
          >
            <span class="event-flow-stepper-bubble">
              <span class="event-flow-stepper-num" aria-hidden="true">
                {index + 1}
              </span>
              <span class="event-flow-stepper-check" aria-hidden="true">
                ✓
              </span>
            </span>
            <span class="event-flow-stepper-label">{step}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
