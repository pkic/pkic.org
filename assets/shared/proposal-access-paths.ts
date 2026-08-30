function apiResourcePath(apiBase: string, segments: readonly string[]): string {
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  return `${base}/${segments.map(encodeURIComponent).join("/")}`;
}

/** Canonical proposal capability resource and its nested resources. */
export function proposalAccessPath(apiBase: string, token: string, ...resourceSegments: string[]): string {
  return apiResourcePath(apiBase, ["proposals", "access", token, ...resourceSegments]);
}

/** Canonical proposal-speaker capability resource and its nested resources. */
export function proposalSpeakerAccessPath(apiBase: string, token: string, ...resourceSegments: string[]): string {
  return apiResourcePath(apiBase, ["proposals", "speakers", "access", token, ...resourceSegments]);
}
