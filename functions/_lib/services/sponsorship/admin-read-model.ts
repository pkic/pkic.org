import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type {
  SponsorshipCompaniesListQuery,
  SponsorshipsListQuery,
} from "../../../../assets/shared/schemas/admin-sponsorships";

export interface AdminSponsorshipRow {
  id: string;
  sponsor_type: string;
  organization_id: string | null;
  organization_name: string | null;
  non_member_name: string | null;
  non_member_website: string | null;
  non_member_logo_r2_key: string | null;
  contact_name: string | null;
  contact_email: string | null;
  event_id: string | null;
  event_name: string | null;
  tier: string | null;
  pipeline_stage: string;
  transition_revision: number;
  start_date: string | null;
  renewal_date: string | null;
  assigned_to_user_id: string | null;
  renewal_action_due_at: string | null;
  assigned_to_name: string | null;
  notes: string | null;
  price_amount_cents: number | null;
  price_currency: string | null;
  created_at: string;
  updated_at: string;
}

const ADMIN_SPONSORSHIP_SELECT = `
  SELECT sp.id, sp.sponsor_type, sp.organization_id, o.name AS organization_name,
         sp.non_member_name, sp.non_member_website, sp.non_member_logo_r2_key, sp.contact_name, sp.contact_email,
         sp.event_id, e.name AS event_name, sp.tier, sp.pipeline_stage, sp.transition_revision,
         sp.start_date, sp.renewal_date, sp.assigned_to_user_id, sp.renewal_action_due_at,
         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS assigned_to_name,
         sp.notes, sp.price_amount_cents, sp.price_currency, sp.created_at, sp.updated_at
  FROM sponsorships sp
  LEFT JOIN organizations o ON o.id = sp.organization_id
  LEFT JOIN events e ON e.id = sp.event_id
  LEFT JOIN users u ON u.id = sp.assigned_to_user_id
`;

type AdminSponsorshipWhereFilters = Pick<SponsorshipsListQuery, "type" | "stage" | "tier" | "q"> &
  Partial<Pick<SponsorshipsListQuery, "organizationId" | "nonMemberName" | "contactName">>;

function buildAdminSponsorshipsWhere(filters: AdminSponsorshipWhereFilters): { where: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.type) {
    conditions.push("sp.sponsor_type = ?");
    values.push(filters.type);
  }
  if (filters.stage) {
    conditions.push("sp.pipeline_stage = ?");
    values.push(filters.stage);
  }
  if (filters.tier) {
    conditions.push("sp.tier = ?");
    values.push(filters.tier);
  }
  if (filters.organizationId) {
    conditions.push("sp.organization_id = ?");
    values.push(filters.organizationId);
  }
  if (filters.nonMemberName) {
    conditions.push("sp.organization_id IS NULL AND sp.non_member_name = ?");
    values.push(filters.nonMemberName);
  }
  if (filters.contactName) {
    conditions.push("sp.organization_id IS NULL AND sp.non_member_name IS NULL AND sp.contact_name = ?");
    values.push(filters.contactName);
  }
  if (filters.q) {
    const search = buildD1TextSearchFilter(filters.q, [
      "o.name",
      "sp.non_member_name",
      "sp.non_member_website",
      "sp.contact_name",
      "sp.contact_email",
      "e.name",
      "sp.tier",
      "sp.pipeline_stage",
      "u.email",
      "u.first_name",
      "u.last_name",
    ]);
    conditions.push(search.sql);
    values.push(...search.bindings);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

export async function listAdminSponsorships(
  db: DatabaseLike,
  filters: SponsorshipsListQuery,
): Promise<{ sponsorships: AdminSponsorshipRow[]; total: number }> {
  const { where, values } = buildAdminSponsorshipsWhere(filters);
  const orderBy = resolveMappedOrderBy(
    filters.sort,
    {
      company: "COALESCE(o.name, sp.non_member_name, sp.contact_name) COLLATE NOCASE",
      eventName: "e.name COLLATE NOCASE",
      tier: "sp.tier COLLATE NOCASE",
      pipelineStage: "sp.pipeline_stage",
      renewalDate: "sp.renewal_date",
      updatedAt: "sp.updated_at",
    },
    "sp.updated_at DESC",
    "sp.id ASC",
  );
  const { rows: sponsorships, total } = await queryPage<AdminSponsorshipRow>(db, {
    sql: `${ADMIN_SPONSORSHIP_SELECT} ${where}`,
    bindings: values,
    orderBy,
    limit: filters.limit,
    offset: filters.offset,
  });
  return { sponsorships, total };
}

export interface AdminSponsorshipCompanyRow {
  key: string;
  label: string;
  website: string | null;
  sponsorshipCount: number;
  /** Comma-separated distinct pipeline stages across this company's sponsorships. */
  stages: string;
}

/** Groups and paginates sponsorship companies in D1. */
export async function listSponsorshipCompanies(
  db: DatabaseLike,
  filters: SponsorshipCompaniesListQuery,
): Promise<{ companies: AdminSponsorshipCompanyRow[]; total: number }> {
  const { where, values } = buildAdminSponsorshipsWhere(filters);
  const groupedCte = `
    WITH grouped AS (
      SELECT
        CASE
          WHEN sp.organization_id IS NOT NULL THEN 'org:' || sp.organization_id
          WHEN sp.non_member_name IS NOT NULL THEN 'nonmember:' || sp.non_member_name
          WHEN sp.contact_name IS NOT NULL THEN 'contact:' || sp.contact_name
          ELSE 'sponsorship:' || sp.id
        END AS key,
        COALESCE(o.name, sp.non_member_name, sp.contact_name, 'Unspecified sponsor') AS label,
        sp.non_member_website AS website,
        sp.pipeline_stage AS stage
      FROM sponsorships sp
      LEFT JOIN organizations o ON o.id = sp.organization_id
      LEFT JOIN events e ON e.id = sp.event_id
      LEFT JOIN users u ON u.id = sp.assigned_to_user_id
      ${where}
    )
  `;
  const orderBy = resolveMappedOrderBy(
    filters.sort,
    { label: "label COLLATE NOCASE", sponsorshipCount: "sponsorshipCount" },
    "label COLLATE NOCASE ASC",
    "key ASC",
  );
  const { rows: companies, total } = await queryPage<AdminSponsorshipCompanyRow>(db, {
    sql: `${groupedCte}
            SELECT key, label, MAX(website) AS website, COUNT(*) AS sponsorshipCount,
                   GROUP_CONCAT(DISTINCT stage) AS stages
            FROM grouped
            GROUP BY key`,
    bindings: values,
    orderBy,
    limit: filters.limit,
    offset: filters.offset,
  });
  return { companies, total };
}

export async function getAdminSponsorship(db: DatabaseLike, id: string): Promise<AdminSponsorshipRow | null> {
  return first<AdminSponsorshipRow>(db, `${ADMIN_SPONSORSHIP_SELECT} WHERE sp.id = ?`, [id]);
}

export function toApiSponsorship(row: AdminSponsorshipRow) {
  return {
    id: row.id,
    sponsorType: row.sponsor_type,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    nonMemberName: row.non_member_name,
    nonMemberWebsite: row.non_member_website,
    nonMemberLogoUrl: row.non_member_logo_r2_key ? `/api/v1/sponsors/${row.id}/logo` : null,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    eventId: row.event_id,
    eventName: row.event_name,
    tier: row.tier,
    pipelineStage: row.pipeline_stage,
    startDate: row.start_date,
    renewalDate: row.renewal_date,
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    notes: row.notes,
    priceAmountCents: row.price_amount_cents,
    priceCurrency: row.price_currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
