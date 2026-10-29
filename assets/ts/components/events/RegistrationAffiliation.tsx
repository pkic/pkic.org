/**
 * The organization and job title a registration shows, read-only.
 *
 * Both come from the person's identity — the one chosen when registering, or
 * their current affiliation — so a registration never edits them. People
 * change them where they manage their identities.
 */
import { ButtonLink } from "../../ui/Button";
import { DescriptionList } from "../../ui/DescriptionList";
import { registrationRepresentationLabel } from "../../shared/acting-identity-catalog";

/** The portal page where a person reviews and edits their identities. */
export const MANAGE_IDENTITIES_HREF = "/portal/#/users/current";

export function RegistrationAffiliation({
  organizationName,
  jobTitle,
  pendingOrganizationName = null,
}: {
  organizationName: string | null;
  jobTitle: string | null;
  pendingOrganizationName?: string | null;
}) {
  return (
    <div class="pk-stack pk-stack--snug">
      <DescriptionList
        items={[
          {
            term: "Representation",
            value: registrationRepresentationLabel({ organizationName, jobTitle }, pendingOrganizationName),
          },
        ]}
      />
      <p class="pk-muted pk-small">Your organization and job title come from your identity.</p>
      <div class="pk-cluster">
        <ButtonLink href={MANAGE_IDENTITIES_HREF} variant="secondary">
          Manage identities
        </ButtonLink>
      </div>
    </div>
  );
}
