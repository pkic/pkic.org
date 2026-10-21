import type { AgendaOccurrence } from "./schemas/event-agenda";

type AgendaSpeakerProfileCandidate = NonNullable<AgendaOccurrence["speakers"][number]["profileCandidate"]>;

/** Frozen canonical appearances supersede the same account's roster name; source-only credits remain distinct. */
export function canonicalSessionCredits(session: AgendaOccurrence) {
  const appearances = session.history?.appearances ?? [];
  // Roster order is authored content. An approved profile replaces that person's
  // display data; it never adds a removed speaker back or changes their position.
  const approved = new Map(appearances.map((credit) => [credit.userId, credit]));
  return session.speakers.map((speaker) => approved.get(speaker.userId) ?? speaker);
}

/** Source attribution is display evidence, never a manufactured account or profile link. */
export function publicSessionCredits(session: AgendaOccurrence) {
  return [...canonicalSessionCredits(session), ...(session.history?.archivalCredits ?? [])];
}

/** Organizer drafts may display the identity a speaker speaks as without granting public appearance approval. */
export function sessionDisplayCredits(session: AgendaOccurrence, organizer = false) {
  const credits = publicSessionCredits(session);
  if (!organizer) return credits;
  const canonical = new Map(session.speakers.map((speaker) => [speaker.userId, speaker]));
  return credits.map((credit) => {
    if (!("userId" in credit)) return credit;
    const speaker = canonical.get(credit.userId);
    const candidate = speaker?.profileCandidate;
    if (!speaker || !candidate) return credit;
    return {
      ...speaker,
      affiliations: (speaker.profileCandidates ?? [candidate]).flatMap(candidateAffiliations),
      biography: candidate.biography ?? "",
      photoUrl: candidate.photoUrl ?? null,
    };
  });
}

/** A speaker's live identity as the one draft affiliation a reviewer starts from. */
export function candidateAffiliations(candidate: AgendaSpeakerProfileCandidate | undefined) {
  if (!candidate || (!candidate.jobTitle && !candidate.organizationName)) return [];
  return [
    {
      identityId: candidate.identityId,
      title: candidate.jobTitle,
      organizationId: candidate.organizationId ?? null,
      organizationName: candidate.organizationName,
    },
  ];
}

/** The headshot a public credit carries: an approved appearance's or a preserved source's; a roster name has none. */
export function publicSessionCreditPhoto(credit: ReturnType<typeof publicSessionCredits>[number]): string | null {
  return "biography" in credit ? (credit.photoUrl ?? null) : null;
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
