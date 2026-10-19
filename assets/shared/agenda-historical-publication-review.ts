import type { AgendaSnapshot } from "./schemas/event-agenda";

/** Source-only attribution and explicit unknown facts require historical publication review. */
export function agendaHistoricalPublicationReview(snapshot: AgendaSnapshot) {
  const occurrenceIds: string[] = [];
  let sourceOnlyCredits = 0;
  let titlesNotRecorded = 0;
  let creditsNotRecorded = 0;
  let endsNotRecorded = 0;
  for (const occurrence of snapshot.occurrences) {
    const history = occurrence.history;
    if (!history) continue;
    const titles = history.sourceDecisions.filter((decision) => decision.decision === "title_not_recorded").length;
    const credits = history.sourceDecisions.filter((decision) => decision.decision === "credit_not_recorded").length;
    const unknownEnd = history.archivalTiming !== null;
    if (history.archivalCredits.length || titles || credits || unknownEnd) occurrenceIds.push(occurrence.id);
    sourceOnlyCredits += history.archivalCredits.length;
    titlesNotRecorded += titles;
    creditsNotRecorded += credits;
    if (unknownEnd) endsNotRecorded++;
  }
  return { occurrenceIds, sourceOnlyCredits, titlesNotRecorded, creditsNotRecorded, endsNotRecorded };
}
