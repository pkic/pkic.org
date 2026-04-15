import type { ComponentChildren } from "preact";

interface SuccessPanelProps {
  icon: string;
  title: string;
  children: ComponentChildren;
}

/**
 * Shared post-submission success panel used across registration, confirmation,
 * and proposal flows. Renders the standard icon + title + body layout.
 *
 * @example
 * <SuccessPanel icon="🎉" title="You're registered!">
 *   <p class="event-flow-success-body">A confirmation email is on its way.</p>
 * </SuccessPanel>
 */
export function SuccessPanel({ icon, title, children }: SuccessPanelProps) {
  return (
    <div class="event-flow-success">
      <div class="event-flow-success-icon" aria-hidden="true">
        {icon}
      </div>
      <h2 class="event-flow-success-title">{title}</h2>
      {children}
    </div>
  );
}
