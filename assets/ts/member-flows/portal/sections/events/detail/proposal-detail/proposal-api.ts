import type { ProposalSpeakerEndpointConfig } from "../../../../../../components/proposals/ProposalSpeakerCard";

/** Canonical proposal resource paths used by the portal detail adapters. */
export function proposalResourcePath(proposalId: string, resource = ""): string {
  const base = `/api/v1/proposals/${encodeURIComponent(proposalId)}`;
  return resource ? `${base}/${resource}` : base;
}

export function proposalSpeakerAssetPath(proposalId: string, userId: string, _asset: "headshot" | "gravatar"): string {
  return proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}/headshot`);
}

export function proposalSpeakerEndpoints(): ProposalSpeakerEndpointConfig {
  return {
    speakerPath: (proposalId, userId, suffix = "") =>
      proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}${suffix ? `/${suffix}` : ""}`),
    assetPath: proposalSpeakerAssetPath,
    reminderPath: (proposalId, userId) =>
      proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}/reminders`),
    reminderBody: (kind) => ({ kind }),
    gravatarBody: { source: "gravatar" },
  };
}
