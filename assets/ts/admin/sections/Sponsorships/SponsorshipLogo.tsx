import { LogoManager } from "../../LogoManager";
import type { Sponsorship } from "../../types";

/**
 * Logo manager for non-member sponsors only (organizationId null) — mirrors
 * Organizations.tsx's OrganizationLogo. Org-tied sponsors show/manage their
 * logo via the organization itself, since that's what the public sponsor
 * list actually reads (organizations.logo_r2_key, GET /api/v1/members/:id/logo).
 */
export function SponsorshipLogo({ sponsorship, onChanged }: { sponsorship: Sponsorship; onChanged: () => void }) {
  return (
    <LogoManager
      endpoint={`/api/v1/admin/sponsorships/${sponsorship.id}/logo`}
      imageUrl={sponsorship.nonMemberLogoUrl}
      alt={`${sponsorship.nonMemberName ?? "Sponsor"} logo`}
      layout="inline"
      imageClass="border rounded p-1 bg-white adm-sponsorship-logo"
      placeholderClass="d-flex align-items-center justify-content-center border rounded bg-light text-muted small adm-sponsorship-logo-placeholder"
      removeConfirmation="Remove this sponsor's logo?"
      removeLabel="Remove logo"
      onChanged={onChanged}
    />
  );
}
