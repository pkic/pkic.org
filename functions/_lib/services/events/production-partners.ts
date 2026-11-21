/**
 * The read of an event's production partners: the roles the event stores, each with its organization's
 * current name, website and logo. One SQL expression and one decoder serve every place that shows them.
 */
import {
  eventProductionPartnerCreditsSchema,
  type EventProductionPartnerCredit,
} from "../../../../assets/shared/schemas/event-production-partners";
import { sanitizeLegacyHttpUrl } from "../../../../assets/shared/schemas/urls";
import { parseJsonSafe } from "../../utils/json";
import { versionedImagePath } from "../image-cache";

/**
 * A JSON array of the event's partners in their stored order, for the `events` row aliased `event`. An
 * organization that no longer exists drops out.
 */
export function eventProductionPartnersJsonSql(event: string): string {
  return `(SELECT json_group_array(json_object('role',credit.role,'organizationId',credit.id,'name',credit.name,
      'website',credit.website,'logoKey',credit.logo_r2_key))
    FROM (SELECT json_extract(partner.value,'$.role') AS role,organization.id,organization.name,organization.website,
                 organization.logo_r2_key
          FROM json_each(${event}.settings_json,'$.productionPartners') partner
          JOIN organizations organization ON organization.id=json_extract(partner.value,'$.organizationId')
          ORDER BY CAST(partner.key AS INTEGER)) credit)`;
}

interface PartnerRow {
  role: string;
  organizationId: string;
  name: string;
  website: string | null;
  logoKey: string | null;
}

export function decodeEventProductionPartners(json: string | null | undefined): EventProductionPartnerCredit[] {
  return eventProductionPartnerCreditsSchema.parse(
    parseJsonSafe<PartnerRow[]>(json ?? "[]", []).map((row) => ({
      role: row.role,
      organizationId: row.organizationId,
      name: row.name,
      website: sanitizeLegacyHttpUrl(row.website),
      logoUrl: versionedImagePath(`/api/v1/members/${row.organizationId}/logo`, row.logoKey),
    })),
  );
}
