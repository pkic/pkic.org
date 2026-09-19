export type ProposalResourceAccess = string | { resourceId: string };

function apiResourcePath(apiBase: string, segments: readonly string[]): string {
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  return `${base}/${segments.map(encodeURIComponent).join("/")}`;
}

/** Canonical proposal capability resource and its nested resources. */
export function proposalAccessPath(
  apiBase: string,
  token: ProposalResourceAccess,
  ...resourceSegments: string[]
): string {
  return apiResourcePath(
    apiBase,
    typeof token === "string"
      ? ["proposals", "access", token, ...resourceSegments]
      : ["proposals", token.resourceId, "submission", ...resourceSegments],
  );
}

/** Canonical proposal-speaker capability resource and its nested resources. */
export function proposalSpeakerAccessPath(
  apiBase: string,
  token: ProposalResourceAccess,
  ...resourceSegments: string[]
): string {
  return apiResourcePath(
    apiBase,
    typeof token === "string"
      ? ["proposals", "speakers", "access", token, ...resourceSegments]
      : [
          "proposals",
          token.resourceId,
          "participation",
          ...(resourceSegments[0] === "participation" ? resourceSegments.slice(1) : resourceSegments),
        ],
  );
}
