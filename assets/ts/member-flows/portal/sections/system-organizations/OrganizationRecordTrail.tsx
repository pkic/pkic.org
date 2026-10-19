/**
 * What every view under an organization record shares: the record it belongs
 * to, loaded once, and the trail back to it. The merge, the email domains and
 * the domain claim form are pages of their own under the record, and the way
 * back is always the record.
 */
import {
  organizationDetailResponseSchema,
  type OrganizationDetail,
} from "../../../../../shared/schemas/organization-management";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { usePortalHashLocation } from "../../hash-location";

/** The portal route of an organization record, or of a view under it. */
export function organizationRecordHref(organizationId: string, child = ""): string {
  return `/organizations/${encodeURIComponent(organizationId)}${child}`;
}

export function useOrganizationRecord(organizationId: string) {
  return useData(
    () =>
      getJson(`/api/v1/organizations/${encodeURIComponent(organizationId)}`, organizationDetailResponseSchema).then(
        (response) => response.organization,
      ),
    [organizationId],
  );
}

/** Organizations › the record › any views between › this view. */
export function OrganizationRecordTrail({
  organization,
  via = [],
  here,
}: {
  organization: OrganizationDetail | null | undefined;
  via?: ReadonlyArray<{ label: string; child: string }>;
  here: string;
}) {
  return (
    <Breadcrumb
      items={[
        { label: "Organizations", href: usePortalHashLocation.hrefs("/organizations") },
        ...(organization
          ? [
              { label: organization.name, href: usePortalHashLocation.hrefs(organizationRecordHref(organization.id)) },
              ...via.map((step) => ({
                label: step.label,
                href: usePortalHashLocation.hrefs(organizationRecordHref(organization.id, step.child)),
              })),
            ]
          : []),
        { label: here },
      ]}
    />
  );
}
