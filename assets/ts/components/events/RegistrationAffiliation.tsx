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
}: RegistrationAffiliationProps & {
  editAction?: ComponentChildren;
}): DescriptionListItem[] {
  const organization = organizationName || PERSONAL_IDENTITY_LABEL;
  const pendingClaim = pendingOrganizationName ? (
    <VerifiedValue
      verified={false}
      pendingLabel="About this claim"
      pendingExplanation="Your organization claim is awaiting approval. It will appear on your badge after approval. This does not affect your conference registration or waitlist status."
    >
      {pendingOrganizationName}
    </VerifiedValue>
  ) : null;
  return [
    {
      term: "Organization",
      value: (
        <span class="pk-cluster pk-cluster--nowrap">
          {organization}
          {editAction}
        </span>
      ),
    },
    {
      term: "Job title",
      value: (
        <span class="pk-cluster pk-cluster--nowrap">
          {jobTitle || (pendingOrganizationName ? "Awaiting organization approval" : "Not provided")}
        </span>
      ),
    },
    ...(pendingClaim ? [{ term: REGISTRATION_ORGANIZATION_VERIFICATION_LABEL, value: pendingClaim }] : []),
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
