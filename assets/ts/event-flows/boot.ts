import { parseQueryContext } from "../shared/query-context";

export interface FlowBoot {
  root: HTMLElement;
  eventSlug: string;
  /** Relative URL of the event page as set by Hugo (e.g. "/events/2026/my-event/").
   *  Sent to the API as `X-Event-Base-Path` so the backend can store the
   *  canonical base path without hardcoding any directory structure. */
  eventPagePath: string | null;
  apiBase: string;
  query: ReturnType<typeof parseQueryContext>;
  statusEl: HTMLElement;
  form: HTMLFormElement;
}

export function bootstrap(selector: string): FlowBoot | null {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) {
    return null;
  }

  const query = parseQueryContext(window.location.search);
  const eventSlug = root.dataset.eventSlug ?? query.eventSlug;
  if (!eventSlug) {
    root.textContent = "Missing event configuration.";
    return null;
  }

  const form = root.querySelector<HTMLFormElement>("form");
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  if (!form || !statusEl) {
    root.textContent = "Invalid flow markup.";
    return null;
  }

  const rawPagePath = root.dataset.eventPagePath?.trim() ?? null;
  // Accept only same-origin relative paths (must start with "/") to prevent fraud.
  const eventPagePath = rawPagePath && rawPagePath.startsWith("/") ? rawPagePath : null;

  return {
    root,
    eventSlug,
    eventPagePath,
    apiBase: root.dataset.apiBase ?? "/api/v1",
    query,
    statusEl,
    form,
  };
}

export function setStatus(target: HTMLElement, message: string, isError = false): void {
  target.textContent = message;
  target.dataset.state = isError ? "error" : "ok";
  target.classList.remove("visually-hidden", "alert-success", "alert-danger");
  target.classList.add(isError ? "alert-danger" : "alert-success");
}
