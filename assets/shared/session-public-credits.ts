import type { AgendaOccurrence } from "./schemas/event-agenda";

/** Frozen canonical appearances supersede the same account's roster name; source-only credits remain distinct. */
export function canonicalSessionCredits(session: AgendaOccurrence) {
  const appearances = session.history?.appearances ?? [];
  const represented = new Set(appearances.map((credit) => credit.userId));
  return [...appearances, ...session.speakers.filter((speaker) => !represented.has(speaker.userId))];
}

/** Source attribution is display evidence, never a manufactured account or profile link. */
export function publicSessionCredits(session: AgendaOccurrence) {
  return [...canonicalSessionCredits(session), ...(session.history?.archivalCredits ?? [])];
}

/** Explicit source roles and canonical roster roles share one presentation policy. */
export function publicSessionCreditRole(
  session: AgendaOccurrence,
  credit: ReturnType<typeof publicSessionCredits>[number],
) {
  return (
    ("role" in credit ? credit.role : session.speakers.find((speaker) => speaker.userId === credit.userId)?.role) ??
    "speaker"
  );
}
