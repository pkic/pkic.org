/**
 * Organization logo upload/removal. Split out of Organizations.tsx (PR #1
 * review).
 */
import { api, apiCommand } from "../../api";
import { LogoManager } from "../../../components/LogoManager";
import { logoUploadResponseSchema } from "../../../../shared/schemas/images";
import { toast } from "../../ui";
import type { AdminOrganizationDetail } from "../../types";

export function OrganizationLogo({ org, onChanged }: { org: AdminOrganizationDetail; onChanged: () => void }) {
  return (
    <LogoManager
      imageUrl={org.logoUrl}
      alt={`${org.name} logo`}
      layout="centered"
      imageClass="img-fluid mb-2 border rounded p-2 bg-white adm-organization-logo"
      placeholderClass="d-flex align-items-center justify-content-center mb-2 border rounded bg-light text-muted adm-organization-logo-placeholder"
      removeConfirmation="Remove this organization's logo?"
      removeLabel="Remove"
      onUpload={(file) =>
        api(`/api/v1/admin/organizations/${org.id}/logo`, logoUploadResponseSchema, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        })
      }
      onRemove={() => apiCommand(`/api/v1/admin/organizations/${org.id}/logo`, { method: "DELETE" })}
      onChanged={onChanged}
      toast={toast}
    />
  );
}
