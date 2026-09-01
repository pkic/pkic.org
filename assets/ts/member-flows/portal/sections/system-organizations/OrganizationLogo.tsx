/**
 * An organization's logo: read-only for viewers, managed for editors.
 *
 * Both readings are a panel, so the mark sits in the record's supporting
 * column as a named region rather than as a loose picture floating above the
 * page. The managed reading is a single `Field` — `LogoManager` owns that
 * composition — and `FileInput`'s preview slot draws the frame and caps the
 * picture, so this surface no longer passes a class in to say how big a logo
 * is or what an empty one looks like.
 */
import { logoUploadResponseSchema } from "../../../../../shared/schemas/images";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { LogoManager } from "../../../../components/LogoManager";
import { deleteJson } from "../../../../shared/api-client";
import { replaceFile } from "../../../../shared/file-upload";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { toast } from "../../ui";

/** The size cap for the read-only picture still lives in the admin stylesheet. */
const LOGO_CLASS = "adm-organization-logo";

export function OrganizationLogo({
  organization,
  canWrite,
  onChanged,
}: {
  organization: OrganizationDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const logoUrl = organization.logoUrl;

  // A viewer with no logo to see gets no region at all: a panel headed "Logo"
  // holding an empty frame announces something missing where nothing is.
  if (!canWrite && !logoUrl) return null;

  return (
    <Panel aria-label="Logo">
      <PanelHeader title="Logo" />
      <PanelBody>
        {canWrite ? (
          <LogoManager
            imageUrl={logoUrl}
            alt={`${organization.name} logo`}
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
        ) : (
          logoUrl && (
            <div class="pk-cluster pk-cluster--center">
              <img class={LOGO_CLASS} src={logoUrl} alt={`${organization.name} logo`} />
            </div>
          )
        )}
      </PanelBody>
    </Panel>
  );
}
