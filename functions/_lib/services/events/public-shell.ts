import {
  parseEventFlowPath,
  EVENT_FLOW_SHELL_PATHS,
  type EventFlowPathContext,
} from "../../../../assets/shared/event-flow-paths";

export interface EventFlowShell {
  assetPath: string;
  context: EventFlowPathContext;
}

/**
 * Resolves one generic event-flow shell without consulting event state. Static
 * authored pages retain precedence in the Worker. Serving the same empty shell
 * for existing and nonexistent slugs avoids an event-existence oracle; the
 * canonical APIs remain solely responsible for event, token, and eligibility
 * validation.
 */
export function resolveEventFlowShell(pathname: string): EventFlowShell | null {
  const context = parseEventFlowPath(pathname);
  if (!context) return null;
  return { assetPath: EVENT_FLOW_SHELL_PATHS[context.flow], context };
}
