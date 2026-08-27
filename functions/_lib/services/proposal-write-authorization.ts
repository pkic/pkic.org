import type { StatementLike } from "../types";

/** Optional transport-context guard for proposal writes (for example, a group/event path binding). */
export interface ProposalWriteAuthorization {
  contextGuard?: StatementLike;
}

/** Keeps domain use cases transport-neutral while including a caller's live context guard in the same D1 batch. */
export function withProposalWriteContextGuard<T extends StatementLike[]>(
  authorization: ProposalWriteAuthorization | undefined,
  statements: T,
): StatementLike[] {
  return authorization?.contextGuard ? [authorization.contextGuard, ...statements] : statements;
}
