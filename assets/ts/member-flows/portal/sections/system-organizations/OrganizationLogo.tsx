/**
 * An organization's logo: read-only for viewers, managed for editors.
 *
 * The framing follows the portal's own logo block in `MyOrganization`: the
 * base layer already keeps an image inside its column (`max-width: 100%`), so
 * the picture needs nothing but its size cap, and only the empty placeholder
 * is drawn as a frame. The border, padding and white fill the Bootstrap
 * version painted behind every logo are gone with it.
 */
import { logoUploadResponseSchema } from "../../../../../shared/schemas/images";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { LogoManager } from "../../../../components/LogoManager";
import { deleteJson } from "../../../../shared/api-client";
import { replaceFile } from "../../../../shared/file-upload";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { toast } from "../../ui";
// `pk-framed` on the placeholder is defined in Content.css, which ships in a
// lazy chunk rather than the entry stylesheet, so the module that writes the
// class name has to pull the stylesheet in itself.
import "../../../../ui/Content.css";

/** The size caps still live in the admin stylesheet; everything else is ours. */
const LOGO_CLASS = "adm-organization-logo";
const LOGO_PLACEHOLDER_CLASS =
  "pk-framed pk-cluster pk-cluster--center pk-muted pk-small adm-organization-logo-placeholder";

export function OrganizationLogo({
  organization,
  canWrite,
  onChanged,
}: {
  organization: OrganizationDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  if (!canWrite) {
    return organization.logoUrl ? (
      <img class={LOGO_CLASS} src={organization.logoUrl} alt={`${organization.name} logo`} />
    ) : null;
  }

  return (
    <LogoManager
      imageUrl={organization.logoUrl}
      alt={`${organization.name} logo`}
      layout="centered"
      imageClass={LOGO_CLASS}
      placeholderClass={LOGO_PLACEHOLDER_CLASS}
      removeConfirmation="Remove this organization's logo?"
      removeLabel="Remove"
      accept="image/svg+xml"
      hint="SVG only. The logo is sanitized, cropped to its content, and made responsive automatically."
      onUpload={(file) =>
        replaceFile(
          `/api/v1/organizations/${encodeURIComponent(organization.id)}/logo`,
          file,
          logoUploadResponseSchema,
          "Could not upload the organization logo.",
        )
      }
      onRemove={() =>
        deleteJson(`/api/v1/organizations/${encodeURIComponent(organization.id)}/logo`, successResponseSchema)
      }
      onChanged={onChanged}
      toast={toast}
    />
  );
}
