import type { ComponentChildren } from "preact";
import type { FieldState } from "./field-state";
import "./FieldStatus.css";

/**
 * The status region a `Field` with `statusId` reports to. It always keeps
 * one line of space, so a message appearing or clearing never moves the
 * control, and it is announced politely. A caller may show its own status in
 * it (a refusal from the server, a reconnect) when the field has nothing to say.
 */
export function FieldStatus({
  id,
  state,
  message,
  children,
}: {
  id: string;
  state?: FieldState;
  message?: string;
  children?: ComponentChildren;
}) {
  const shown = state && message ? state : undefined;
  return (
    <p
      id={id}
      class={["pk-field__status", shown ? `pk-field--${shown}` : null].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      {shown && message ? message : children}
    </p>
  );
}
