/** Eligibility never interprets a GitHub completion as membership approval. */
export function applicationImportEligibility(source) {
  const issue = source.issue;
  if (issue.pull_request) return { eligible: false, reason: "pull_request" };
  if (!issue.labels.some((label) => label.id === source.labelId && label.name === "Membership application"))
    return { eligible: false, reason: "missing_label" };
  const timeline = [...source.timeline].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  let duplicate = false;
  for (const event of timeline) {
    if (event.event === "marked_as_duplicate") duplicate = true;
    if (event.event === "unmarked_as_duplicate") duplicate = false;
  }
  if (duplicate || issue.state_reason === "duplicate") return { eligible: false, reason: "duplicate" };
  if (issue.state === "open") return { eligible: true, reason: "open" };
  if (issue.state_reason !== "completed")
    return { eligible: false, reason: issue.state_reason === "not_planned" ? "not_planned" : "ambiguous_closure" };
  const lastDisposition = timeline.filter((event) => event.event === "closed" || event.event === "reopened").at(-1);
  if (lastDisposition?.event !== "closed" || !issue.closed_at) return { eligible: false, reason: "ambiguous_closure" };
  return { eligible: true, reason: "completed" };
}
