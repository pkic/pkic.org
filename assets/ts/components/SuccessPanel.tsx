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
 * Three things changed when it came off the legacy `event-flow-success` rules:
 *
 *   - The panel is a `role="status"` region. It appears in place of the form
 *     the reader just submitted, so it is a state change, and the version
 *     this replaces announced nothing at all.
 *   - The icon lives inside the heading rather than in a block sized at
 *     `2.8rem`. It is decorative, so it stays `aria-hidden` and out of the
 *     heading's accessible name; putting it there is what lets it take the
 *     heading's size from the type scale instead of a literal.
 *   - `.event-flow-success-title` existed only to undo the surrounding page's
 *     gradient clip-text on `h2`. Inside `.pk` there is nothing to undo.
 *
 * @example
 * <SuccessPanel icon="🎉" title="You're registered!">
 *   <p>A confirmation email is on its way.</p>
 * </SuccessPanel>
 */
export function SuccessPanel({ icon, title, children }: SuccessPanelProps) {
  return (
    <div class="pk pk-stack pk-center" role="status">
      <h2 class="pk-stack pk-stack--tight">
        <span aria-hidden="true">{icon}</span>
        <span>{title}</span>
      </h2>
      {children}
    </div>
  );
}
