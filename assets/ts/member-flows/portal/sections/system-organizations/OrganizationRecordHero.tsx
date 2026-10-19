/**
 * The organization a page is about, stated once: the record's hero.
 *
 * The record itself and every view under it (email domains, the domain claim,
 * the merge) open with this same header, so a sub-page never loses whose data
 * it shows. The record adds the editable mark, the live title while editing
 * and its "…" menu; a sub-page shows the subject read-only and puts its own
 * heading below.
 */
import type { ComponentChildren } from "preact";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { useMembershipCategoryLabels } from "../../../../hooks/useMembershipCategoryLabels";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { fmtDate } from "../../ui";
import { OrganizationLogo } from "./OrganizationLogo";

export function OrganizationRecordHero({
  organization,
  title = organization.name,
  lede = organization.slogan ?? undefined,
  canWrite = false,
  onChanged,
  actions,
}: {
  organization: OrganizationDetail;
  /** The record page passes the Name field's value while it is edited. */
  title?: string;
  lede?: string;
  /** Lets the mark be changed in place; only the record page offers it. */
  canWrite?: boolean;
  onChanged?: () => Promise<void>;
  actions?: ComponentChildren;
}) {
  const categories = useMembershipCategoryLabels(Boolean(organization.membershipCategory));
  const count = organization.activeIdentityCount;
  return (
    <ProfileHeader
      media={
        <OrganizationLogo
          size="mark"
          organization={organization}
          canWrite={canWrite && Boolean(onChanged)}
          onChanged={onChanged ?? (() => Promise.resolve())}
        />
      }
      title={title}
      lede={lede}
      facts={[
        organization.membershipCategory ? <>{categories.label(organization.membershipCategory)}</> : null,
        organization.memberSince ? `Member since ${fmtDate(organization.memberSince)}` : null,
        /* Reads as a sentence rather than as a bare number. */
        `${String(count)} active ${count === 1 ? "representative" : "representatives"}`,
      ].filter((fact) => fact !== null)}
      actions={actions}
    />
  );
}
