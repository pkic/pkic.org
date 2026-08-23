export interface ProposalInvitePerson {
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
}

export function formatProposalInvitePerson(person: ProposalInvitePerson): string {
  const fullName = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  if (fullName && person.organization_name?.trim()) return `${fullName} (${person.organization_name.trim()})`;
  return fullName || person.email;
}
