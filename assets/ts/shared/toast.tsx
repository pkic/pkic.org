/*
 * The toast is mounted imperatively, because the callers are a mix of Preact
 * components and plain modules that only have a container id. What it mounts
 * is the design system's `Toast`, so the markup, the live-region role and the
 * tone classes have one definition.
 */
import { render } from "preact";

import { Toast, type ToastTone } from "../ui/Toast";

export type ToastType = "success" | "error" | "info";

const TOAST_TONE: Record<ToastType, ToastTone> = {
  success: "ok",
  error: "danger",
  info: "info",
};

/** How long a toast stays before it retires itself. */
const TOAST_DWELL_MS = 5000;

export function showToast(targetId: string, message: string, type: ToastType = "info"): void {
  const area = document.getElementById(targetId);
  if (!area) return;
  const host = document.createElement("div");
  area.appendChild(host);
  // `my-toast` stays: the container's fixed positioning still comes from the
  // portal stylesheet, and the end-to-end specs locate toasts by it.
  render(<Toast tone={TOAST_TONE[type]} message={message} class="my-toast pk" />, host);
  setTimeout(() => {
    render(null, host);
    host.remove();
  }, TOAST_DWELL_MS);
}
