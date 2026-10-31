export interface ProposalInvitePerson {
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
}

/** A person's name, with the organization they appear for; empty when no name is known, never their address. */
export function formatProposalInvitePerson(person: ProposalInvitePerson): string {
  const fullName = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  if (fullName && person.organization_name?.trim()) return `${fullName} (${person.organization_name.trim()})`;
  return fullName;
}

/** One line per named person; a person without a name is left out rather than shown by address. */
export function formatProposalSpeakerLineup(people: ProposalInvitePerson[]): string {
  return people
    .map(formatProposalInvitePerson)
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");
}
