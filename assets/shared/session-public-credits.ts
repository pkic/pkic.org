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

/** Organizer drafts may display recorded proposal selections without granting public appearance approval. */
export function sessionDisplayCredits(session: AgendaOccurrence, organizer = false) {
  const credits = publicSessionCredits(session);
  if (!organizer) return credits;
  const approved = new Set((session.history?.appearances ?? []).map((credit) => credit.userId));
  return credits.map((credit) => {
    if (!("userId" in credit) || approved.has(credit.userId)) return credit;
    const selection = session.history?.proposalRepresentations.find(
      (item) => item.userId === credit.userId && item.selectedAt !== null && item.snapshot !== null,
    );
    const candidate = "profileCandidate" in credit ? credit.profileCandidate : undefined;
    if (!selection?.snapshot && !candidate) return credit;
    return {
      ...credit,
      actingIdentityId: selection?.actingIdentityId ?? null,
      jobTitle: selection?.snapshot?.jobTitle ?? null,
      organizationName: selection?.snapshot?.organizationName ?? null,
      biography: selection?.snapshot?.biography || candidate?.biography || "",
      photoUrl: candidate?.photoUrl ?? null,
    };
  });
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
