export const actorId = "11111111-1111-4111-8111-111111111111";
export const databaseId = "705d4a53-c607-4b4f-bf90-74fc1c079d37";
export function reviewedManifest(localDirectory: string | null = null) {
  return {
    version: 2,
    runId: "22222222-2222-4222-8222-222222222222",
    actorUserId: actorId,
    environment: localDirectory ? "local" : "production",
    databaseId,
    localDirectory,
    sourceData: localDirectory ? "synthetic" : "private",
    entries: [1, 2].map((sourceIssueNumber) => ({
      decision: "import",
      sourceIssueNumber,
      source: {
        repository: "pkic/members",
        labelId: 7,
        issue: {
          id: 100 + sourceIssueNumber,
          number: sourceIssueNumber,
          html_url: `https://github.com/pkic/members/issues/${sourceIssueNumber}`,
          title: "Example Organization application",
          body: "Original form: Example User's application; consent was not recorded.",
          state: "closed",
          state_reason: "completed",
          labels: [{ id: 7, name: "Membership application" }],
          created_at: "2020-01-01T00:00:00.000Z",
          updated_at: "2020-01-03T00:00:00.000Z",
          closed_at: "2020-01-03T00:00:00.000Z",
        },
        comments: [
          {
            id: 201,
            created_at: "2020-01-02T00:00:00.000Z",
            body: "The application was declined after review.",
            user: { login: "example-reviewer" },
          },
        ],
        timeline: [
          { id: 301, event: "closed", created_at: "2020-01-03T00:00:00.000Z", actor: { login: "example-reviewer" } },
        ],
      },
      reviewedBy: "Example reviewer",
      reviewedAt: "2026-01-02T00:00:00.000Z",
      mapping: {
        applicantName: "Example User",
        applicantEmail: `user${sourceIssueNumber}@example.org`,
        organizationName: "Example Organization",
        membershipCategory: "A",
        applicantUserId: null,
        outcome: "declined",
        decisionAt: "2020-01-02T00:00:00.000Z",
        mappingReason: "The source review comment explicitly records the rejection decision.",
      },
    })),
  };
}
