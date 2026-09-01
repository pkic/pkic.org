/**
 * Toast — a transient confirmation.
 *
 * A status message, not an interruption. Uses role="status" (not role="alert"),
 * and resolves its tone through modifier classes to keep the tone definitions
 * in the stylesheet.
 */

import type { JSX } from "preact";

import "./Toast.css";

export type ToastTone = "ok" | "info" | "danger";

export interface ToastAction {
  label: string;
  onSelect: () => void;
}

export interface ToastProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "role" | "message"> {
  tone?: ToastTone;
  message: string;
  action?: ToastAction;
  onDismiss?: () => void;
}

export function Toast({ tone = "ok", message, action, onDismiss, class: className, ...rest }: ToastProps) {
  const classes = ["pk-toast", `pk-toast--${tone}`, className].filter(Boolean).join(" ");

  return (
    <div {...rest} role="status" class={classes}>
      <div class="pk-toast__dot" aria-hidden="true" />
      <div class="pk-toast__message">{message}</div>

      {action && (
        <button class="pk-toast__action" onClick={action.onSelect}>
          {action.label}
        </button>
      )}

      {onDismiss && (
        <button class="pk-toast__dismiss" onClick={onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      )}
    </div>
  );
}
