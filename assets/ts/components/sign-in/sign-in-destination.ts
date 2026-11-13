/**
 * What a flow tells the sign-in card about itself. The card draws what it is
 * handed and knows nothing else about the flow; the registry of flows lives
 * with the screen that reads return paths.
 */
import type { ComponentType } from "preact";
import type { EmailFirstFlow } from "../../../shared/email-first-copy";

/** What a flow adds once it has loaded: its own progress, and a title naming what the person came for. */
export interface SignInDestinationDetail {
  Progress?: ComponentType;
  title?: string;
}

export interface SignInDestination {
  /** The portal return paths this flow owns. */
  pattern: RegExp;
  title: string;
  lede: string;
  /** Under "New here?": what starting with an email leads to. */
  startHint: string;
  startLabel: string;
  /** Which wording the work-or-personal email step uses. */
  emailFlow: EmailFirstFlow;
  /** Loads what only the flow knows, so the start reads as its first step. */
  load?: (returnPath: string) => Promise<SignInDestinationDetail>;
}
