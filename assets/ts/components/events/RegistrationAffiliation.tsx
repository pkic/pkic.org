/**
 * The organization and job title a registration shows, read-only.
 *
 * Details come from the selected identity. An organization claim awaiting
 * approval is review state and does not supply profile or badge details.
 */
import type { ComponentChildren } from "preact";
import { ButtonLink } from "../../ui/Button";
import { DescriptionList, type DescriptionListItem } from "../../ui/DescriptionList";
import {
  PERSONAL_IDENTITY_LABEL,
  REGISTRATION_ORGANIZATION_VERIFICATION_LABEL,
} from "../../shared/acting-identity-catalog";
import { VerifiedValue } from "../../ui/VerifiedValue";

/** The portal page where a person reviews and edits their identities. */
export const MANAGE_IDENTITIES_HREF = "/portal/#/users/current";

interface RegistrationAffiliationProps {
  organizationName: string | null;
  jobTitle: string | null;
  pendingOrganizationName?: string | null;
}

/** The same labeled identity facts in the registration summary and its existing editor. */
export function registrationAffiliationItems({
  organizationName,
  jobTitle,
  pendingOrganizationName = null,
  editAction,
  jobTitleEditAction,
}: RegistrationAffiliationProps & {
  editAction?: ComponentChildren;
  jobTitleEditAction?: ComponentChildren;
}): DescriptionListItem[] {
  const organization = organizationName || PERSONAL_IDENTITY_LABEL;
  const representation = pendingOrganizationName ? (
    <VerifiedValue
      verified={false}
      pendingLabel={REGISTRATION_ORGANIZATION_VERIFICATION_LABEL}
      pendingExplanation="Your organization claim is awaiting approval. Your organization and job title come from your identity and appear on your badge only after approval. This does not affect your conference registration or waitlist status."
    >
      {organization}
    </VerifiedValue>
  ) : (
    organization
  );
  return [
    {
      term: "Organization",
      value: (
        <span class="pk-cluster pk-cluster--nowrap">
          {representation}
          {editAction}
        </span>
      ),
    },
    {
      term: "Job title",
      value: (
        <span class="pk-cluster pk-cluster--nowrap">
          {jobTitle || "Not provided"}
          {jobTitleEditAction}
        </span>
      ),
    },
  ];
}

export function RegistrationAffiliation(props: RegistrationAffiliationProps) {
  return (
    <div class="pk-stack pk-stack--snug">
      <DescriptionList align="baseline" items={registrationAffiliationItems(props)} />
      <p class="pk-muted pk-small">Your organization and job title come from your identity.</p>
      <div class="pk-cluster">
        <ButtonLink href={MANAGE_IDENTITIES_HREF} variant="secondary">
          Manage identities
        </ButtonLink>
      </div>
    </div>
  );
}
