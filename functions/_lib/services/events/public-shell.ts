import {
  parseEventFlowPath,
  type EventFlowKind,
  type EventFlowPathContext,
} from "../../../../assets/shared/event-flow-paths";

const SHELL_ASSET_PATHS: Readonly<Record<EventFlowKind, string>> = {
  registration: "/_event-flow-shells/registration/",
  registrationConfirm: "/_event-flow-shells/registration-confirm/",
  registrationManage: "/_event-flow-shells/registration-manage/",
  proposal: "/_event-flow-shells/proposal/",
  proposalManage: "/_event-flow-shells/proposal-manage/",
  speakerManage: "/_event-flow-shells/speaker-manage/",
  speakerPresentation: "/_event-flow-shells/speaker-presentation/",
  inviteDecline: "/_event-flow-shells/invite-decline/",
};

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
  return { assetPath: SHELL_ASSET_PATHS[context.flow], context };
}
