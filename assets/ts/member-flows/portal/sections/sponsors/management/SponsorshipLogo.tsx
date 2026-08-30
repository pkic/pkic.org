import { deleteJson, requestJson } from "../../../../../shared/api-client";
import { logoUploadResponseSchema } from "../../../../../../shared/schemas/images";
import { successResponseSchema } from "../../../../../../shared/schemas/api-common";
import { toast } from "../../../ui";
import type { Sponsorship } from "../../../../../../shared/schemas/sponsorship-management";
import { LogoManager } from "../../../../../components/LogoManager";

/**
 * Logo manager for non-member sponsors only (organizationId null) — mirrors
 * Organizations.tsx's OrganizationLogo. Org-tied sponsors show/manage their
 * logo via the organization itself, since that's what the public sponsor
 * list actually reads (organizations.logo_r2_key, GET /api/v1/members/:id/logo).
 */
export function SponsorshipLogo({ sponsorship, onChanged }: { sponsorship: Sponsorship; onChanged: () => void }) {
  const endpoint = `/api/v1/sponsors/${encodeURIComponent(sponsorship.id)}/logo`;

  return (
    <LogoManager
      imageUrl={sponsorship.nonMemberLogoUrl}
      alt={`${sponsorship.nonMemberName ?? "Sponsor"} logo`}
      layout="inline"
      imageClass="border rounded p-1 bg-white sponsorship-management-logo"
      placeholderClass="d-flex align-items-center justify-content-center border rounded bg-light text-muted small sponsorship-management-logo-placeholder"
      removeConfirmation="Remove this sponsor's logo?"
      removeLabel="Remove logo"
      accept="image/svg+xml"
      hint="SVG only. The logo is sanitized, cropped to its content, and made responsive automatically."
      onUpload={(file) =>
        requestJson(endpoint, logoUploadResponseSchema, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        })
      }
      onRemove={() => deleteJson(endpoint, successResponseSchema)}
      onChanged={onChanged}
      toast={toast}
    />
  );
}
