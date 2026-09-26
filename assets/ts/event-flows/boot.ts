import { parseQueryContext } from "../shared/query-context";
import { parseEventFlowPath } from "../../shared/event-flow-paths";

// Re-export setStatus from form-helpers so existing `import { setStatus } from "./boot"`
// statements continue to work.
export { setStatus } from "../shared/form/helpers";

export interface FlowBoot {
  root: HTMLElement;
  eventSlug: string;
  /** Canonical relative event root derived from authored markup or the shared
   *  runtime path grammar. Hugo pages may send it as `X-Event-Base-Path` for
   *  legacy publication discovery; portal routes are server-owned. */
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
  const pathContext = parseEventFlowPath(window.location.pathname);
  const eventSlug = root.dataset.eventSlug?.trim() || pathContext?.eventSlug || query.eventSlug;
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

  const rawPagePath = root.dataset.eventPagePath?.trim() || pathContext?.eventBasePath || null;
  // Accept only a same-origin relative path.
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
