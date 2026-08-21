/**
 * Organization logo upload/removal. Split out of Organizations.tsx (PR #1
 * review).
 */
import { LogoManager } from "../../LogoManager";
import type { AdminOrganizationDetail } from "../../types";

export function OrganizationLogo({ org, onChanged }: { org: AdminOrganizationDetail; onChanged: () => void }) {
  return (
    <LogoManager
      endpoint={`/api/v1/admin/organizations/${org.id}/logo`}
      imageUrl={org.logoUrl}
      alt={`${org.name} logo`}
      layout="centered"
      imageClass="img-fluid mb-2 border rounded p-2 bg-white adm-organization-logo"
      placeholderClass="d-flex align-items-center justify-content-center mb-2 border rounded bg-light text-muted adm-organization-logo-placeholder"
      removeConfirmation="Remove this organization's logo?"
      removeLabel="Remove"
      onChanged={onChanged}
    />
  );
}
