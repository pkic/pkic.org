import type { GithubApplicationEvidence } from "./schemas/membership-application-import";

/** The requester-required hold must be acknowledged in the reviewed mapping before first import. */
export function applicationImportRequiresManualHold(source: GithubApplicationEvidence): boolean {
  return source.repository === "pkic/members" && source.issue.number === 795 && source.issue.state === "open";
}

/** Eligibility never interprets a GitHub completion as membership approval. */
export function applicationImportEligibility(source: GithubApplicationEvidence): { eligible: boolean; reason: string } {
  const issue = source.issue;
  if (issue.pull_request) return { eligible: false, reason: "pull_request" };
  if (!issue.labels.some((label) => label.id === source.labelId && label.name === "Membership application"))
    return { eligible: false, reason: "missing_label" };
  let duplicate = false;
  for (const event of source.timeline) {
    if (event.event === "marked_as_duplicate") duplicate = true;
    if (event.event === "unmarked_as_duplicate") duplicate = false;
  }
  if (duplicate || issue.state_reason === "duplicate") return { eligible: false, reason: "duplicate" };
  if (issue.state === "open") return { eligible: true, reason: "open" };
  if (issue.state_reason !== "completed") return { eligible: false, reason: issue.state_reason ?? "ambiguous_closure" };
  const lastDisposition = source.timeline
    .filter((event) => event.event === "closed" || event.event === "reopened")
    .at(-1);
  if (lastDisposition?.event !== "closed" || !issue.closed_at) return { eligible: false, reason: "ambiguous_closure" };
  return { eligible: true, reason: "completed" };
}

/** Source fields remain strings. In particular, absent consent never becomes false or true. */
export function historicalApplicationFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const matches = [...body.matchAll(/^\*\*([^*]+)\*\*:\s*(.*)$/gm)];
  matches.forEach((match, index) => {
    const end = matches[index + 1]?.index ?? body.length;
    fields[match[1]] = body.slice(match.index! + match[0].indexOf(":") + 1, end).trim();
  });
  return fields;
}

export function proposedHistoricalOutcome(labels: readonly string[]) {
  const outcomes = new Set<string>();
  if (labels.includes("Member Profile") || labels.includes("Add to Mailing Lists")) outcomes.add("approved");
  if (labels.includes("Reject Application") || labels.includes("Rejected")) outcomes.add("declined");
  if (labels.includes("Withdrew")) outcomes.add("withdrawn");
  return outcomes.size === 1 ? [...outcomes][0] : "closed_unknown";
}

/** Labels identify the pending requirement, never completion of earlier requirements. */
export function sourceApplicationRequirement(labels: readonly string[]) {
  const requirements = [
    ...(labels.includes("Member Consultation") ? ["active_voting_members" as const] : []),
    ...(labels.includes("Approval by Executive Council") ? ["executive_council" as const] : []),
    ...(labels.includes("Needs due diligence") ? ["staff_review" as const] : []),
  ];
  return requirements.length === 1 ? requirements[0] : null;
}
