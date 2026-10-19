export const organizationId = "00000000-0000-4000-8000-000000000210";
export const userId = "00000000-0000-4000-8000-000000000211";
export const memberId = "00000000-0000-4000-8000-000000000212";
export const identityId = "00000000-0000-4000-8000-000000000213";

export function pendingReview() {
  return {
    id: "00000000-0000-4000-8000-000000000220",
    organizationId,
    submittedByUserId: userId,
    proposedChanges: { slogan: "New slogan" },
    hasLogoChange: false,
    status: "pending" as const,
    reviewerUserId: null,
    reviewerNote: null,
    submittedAt: "2026-08-20T00:00:00.000Z",
    reviewedAt: null,
  };
}

export function organizationWithPendingReview() {
  return {
    id: organizationId,
    name: "Example Organization",
    website: "https://example.test",
    description: "Example profile",
    slogan: null,
    logoUrl: null,
    contentMarkdown: null,
    blogUrl: null,
    blogFeedUrl: null,
    pressUrl: null,
    pressFeedUrl: null,
    careersUrl: null,
    links: [],
    isOrgContact: true,
    isPrimaryContact: true,
    isSecondaryContact: false,
    primaryContact: null,
    secondaryContact: null,
    pendingSecondaryContact: null,
    pendingSecondaryContactUserId: null,
    pendingReview: pendingReview(),
  };
}

export function organizationProfile(overrides: Record<string, unknown> = {}) {
  return { ...organizationWithPendingReview(), pendingReview: null, ...overrides };
}
