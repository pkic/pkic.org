import type { VoteScopeType } from "../../types";

/** The list API resolves scope labels in one bounded backend query per page. */
export function ScopeBadge({ scopeType, scopeName }: { scopeType: VoteScopeType; scopeName: string | null }) {
  return <>{scopeType === "forum" ? "Forum" : (scopeName ?? "Working Group")}</>;
}
