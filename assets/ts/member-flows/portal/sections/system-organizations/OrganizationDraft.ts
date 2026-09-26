/**
 * The organization page's editable fields, as the reader edits them in
 * place: one draft for the whole page, one Save, one PATCH carrying the
 * record's revision. Every card reads the same draft, so editing keeps the
 * page's own layout instead of collapsing into a form.
 */
import type {
  OrganizationDetail,
  OrganizationManagementUpdateInput,
} from "../../../../../shared/schemas/organization-management";

export const ORGANIZATION_TEXT_FIELDS = [
  "name",
  "slogan",
  "description",
  "contentMarkdown",
  "website",
  "blogUrl",
  "blogFeedUrl",
  "pressUrl",
  "pressFeedUrl",
  "careersUrl",
] as const;
export type OrganizationTextField = (typeof ORGANIZATION_TEXT_FIELDS)[number];

export interface OrganizationDraft extends Record<OrganizationTextField, string> {
  links: OrganizationDetail["links"];
  membershipCategory: string;
  memberSince: string;
  primaryContactUserId: string;
  secondaryContactUserId: string;
}

export function draftFromOrganization(organization: OrganizationDetail): OrganizationDraft {
  return {
    ...(Object.fromEntries(ORGANIZATION_TEXT_FIELDS.map((field) => [field, organization[field] ?? ""])) as Record<
      OrganizationTextField,
      string
    >),
    links: organization.links,
    membershipCategory: organization.membershipCategory ?? "",
    memberSince: organization.memberSince.slice(0, 10),
    primaryContactUserId: organization.primaryContactUserId ?? "",
    secondaryContactUserId: organization.secondaryContactUserId ?? "",
  };
}

/** The shared update contract's body for a draft; empty text is an absent value. */
export function payloadFromDraft(draft: OrganizationDraft, revision: string): OrganizationManagementUpdateInput {
  const text = (field: OrganizationTextField) => draft[field].trim() || null;
  return {
    name: draft.name.trim(),
    slogan: text("slogan"),
    description: text("description"),
    contentMarkdown: text("contentMarkdown"),
    website: text("website"),
    blogUrl: text("blogUrl"),
    blogFeedUrl: text("blogFeedUrl"),
    pressUrl: text("pressUrl"),
    pressFeedUrl: text("pressFeedUrl"),
    careersUrl: text("careersUrl"),
    links: draft.links,
    ...(draft.membershipCategory ? { membershipCategory: draft.membershipCategory } : {}),
    memberSince: draft.memberSince || null,
    primaryContactUserId: draft.primaryContactUserId || null,
    secondaryContactUserId: draft.secondaryContactUserId || null,
    revision,
  } as OrganizationManagementUpdateInput;
}
