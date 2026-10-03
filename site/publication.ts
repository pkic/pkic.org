import { readPublicationSource } from "./publication-source";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../assets/shared/schemas/membership-categories";

export const publication = await readPublicationSource();
export const organizationMembers = publication.members.filter(
  (member) => !INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(member.memberType),
);
export const memberCounts = {
  organization: organizationMembers.length,
  independent: publication.members.length - organizationMembers.length,
};
