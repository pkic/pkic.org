/** Prepare the production domain resolver's bounded observations in one request batch. */
import type { z } from "zod";
import { batchFirst, batchRows } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import { emailHost, organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import { normalizeOrgName } from "../../../../assets/shared/organization-name";
import { slugifyOr } from "../../../../assets/shared/slug";
import { OWN_ADDRESSES_SQL, OWN_ADDRESS_COLUMNS, type OwnAddressRow, toAddress } from "../own-email-address-read";
import {
  domainOwnershipFactMatchesSql,
  FACT_ORGANIZATION,
  requireWorkOrganizationDomain,
} from "./verified-email-domain";
import { boundedDomainClaimsRows, domainClaimsObservationSelection } from "./affiliation-evidence";
import { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";

type Basis = z.infer<typeof verifiedAffiliationBasisSchema>;
export function prepareVerifiedAffiliationRead(
  db: DatabaseLike,
  userId: string | { sql: string; bindings: unknown[] },
  input: {
    email: string;
    emailId: string | null;
    organizationName?: string;
    domain?: string;
    unaffiliatedAttestation?: boolean;
  },
  mailboxProof?: { verifiedAt: string },
) {
  const subject = typeof userId === "string" ? { sql: "?", bindings: [userId] } : userId;
  const candidates = organizationDomainCandidates(input.email);
  const domains = JSON.stringify(candidates);
  const matches = domainOwnershipFactMatchesSql("requested.value");
  const slug = slugifyOr(input.organizationName ?? "", "member");
  const claimRead = domainClaimsObservationSelection(input.email);
  // Subdomains below the address's own host; a sibling such as parliament.europa.eu is never below council.europa.eu.
  const below = `.${emailHost(input.email) ?? ""}`;
  const statements = [
    mailboxProof
      ? db
          .prepare(`SELECT (SELECT address.id FROM user_emails address WHERE address.normalized_email=? AND address.verified_at IS NOT NULL AND address.user_id=(${subject.sql})) AS id,
            ? AS email,1 AS is_primary,? AS verified_at,'registration_confirmation' AS verification_method,NULL AS identity_id,? AS created_at,0 AS sign_in_enabled`)
          .bind(input.email, ...subject.bindings, input.email, mailboxProof.verifiedAt, mailboxProof.verifiedAt)
      : db
          .prepare(`${OWN_ADDRESSES_SQL} SELECT ${OWN_ADDRESS_COLUMNS} FROM addresses WHERE id IS ? LIMIT 1`)
          .bind(userId, userId, input.emailId),
    db.prepare(claimRead.sql).bind(...claimRead.bindings),
    db
      .prepare(`WITH facts AS (
      SELECT requested.value AS domain,${FACT_ORGANIZATION} AS id,
        MAX(CASE WHEN fact.verified_email_domain IS NOT NULL AND fact.source='verified_email' AND fact.started_at IS NOT NULL
          AND fact.ended_at IS NULL AND fact.blocked_at IS NULL AND person.active=1 THEN 1 ELSE 0 END) AS active,
        MAX(CASE WHEN fact.blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS disputed,
        MAX(CASE WHEN fact.verified_email_domain IS NULL THEN 1 ELSE 0 END) AS unknown
      FROM json_each(?) requested JOIN identities fact ON ${matches} JOIN users person ON person.id=fact.user_id
      WHERE fact.organization_id IS NOT NULL GROUP BY requested.value,${FACT_ORGANIZATION}
    ), ranked AS (SELECT domain,id,active,disputed,unknown,ROW_NUMBER() OVER(PARTITION BY domain ORDER BY id) AS position FROM facts)
      SELECT domain,id,active,disputed,unknown FROM ranked WHERE position<=257`)
      .bind(domains),
    db
      .prepare(`SELECT organization.id,organization.name,organization.normalized_name,organization.merged_into_organization_id,member.id AS member_id
      FROM organizations organization LEFT JOIN members member ON member.organization_id=organization.id
      WHERE organization.normalized_name=? OR organization.id IN (
        SELECT claim.organization_id FROM organization_domain_claims claim JOIN json_each(?) requested ON claim.domain=requested.value
        UNION SELECT ${FACT_ORGANIZATION} FROM identities fact JOIN json_each(?) requested ON ${matches}
        UNION SELECT organization_id FROM identities WHERE user_id=(${subject.sql})
          AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
        UNION SELECT organization_id FROM organization_domain_claims WHERE length(domain)>? AND substr(domain,-?)=?
      ) ORDER BY organization.name,organization.id LIMIT 257`)
      .bind(
        normalizeOrgName(input.organizationName ?? ""),
        domains,
        domains,
        ...subject.bindings,
        below.length,
        below.length,
        below,
      ),
    db
      .prepare(`SELECT id,organization_id,email_id,updated_at,invited_at,started_at,ended_at,blocked_at,job_title
      FROM identities WHERE user_id=(${subject.sql}) ORDER BY id LIMIT 501`)
      .bind(...subject.bindings),
    db
      .prepare(`SELECT identity_id FROM user_emails WHERE id=? AND user_id=(${subject.sql})`)
      .bind(input.emailId, ...subject.bindings),
    db
      .prepare(`SELECT slug FROM organizations WHERE ?=1 AND (slug=? OR slug GLOB ?) ORDER BY slug LIMIT 1001`)
      .bind(input.organizationName ? 1 : 0, slug, `${slug}-[0-9]*`),
    db
      .prepare(`SELECT id,domain,organization_id AS organizationId FROM organization_domain_claims
      WHERE organization_id IS NOT NULL AND length(domain)>? AND substr(domain,-?)=?
      ORDER BY length(domain),domain,id LIMIT 129`)
      .bind(below.length, below.length, below),
  ];
  return {
    statements,
    decode(results: D1StatementResult[]) {
      const address = batchFirst<OwnAddressRow>(results[0]);
      if (!address || address.email.toLowerCase() !== input.email.toLowerCase() || !address.verified_at)
        throw new AppError(
          422,
          "IDENTITY_EMAIL_UNVERIFIED",
          "Verify this representation email address before continuing.",
        );
      const claims = boundedDomainClaimsRows<{
        id: string;
        domain: string;
        organizationId: string;
      }>(results[1]);
      if (input.domain && !organizationDomainCandidates(address.email).includes(input.domain))
        throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "Choose a domain of your verified work email address.");
      const rootDomain = workEmailDomain(address.email);
      const knownRoot = batchRows<{ domain: string }>(results[2]).some((fact) => fact.domain === rootDomain);
      const suggested = knownRoot ? rootDomain : (candidates[0] ?? rootDomain);
      const domain = input.unaffiliatedAttestation
        ? emailHost(address.email)!
        : requireWorkOrganizationDomain(input.domain ?? claims[0]?.domain ?? suggested);
      const claim = claims.find((item) => item.domain === domain) ?? null;
      const derived = batchRows<{
        domain: string;
        id: string;
        active: number;
        disputed: number;
        unknown: number;
      }>(results[2]).filter((fact) => fact.domain === domain);
      const claimed = claims.filter((item) => item.domain === domain);
      const related = [
        ...claims.filter((item) => item.domain !== domain),
        ...boundedDomainClaimsRows<{ id: string; domain: string; organizationId: string }>(results[7]),
      ].filter(
        (item, index, all) =>
          !claimed.some((own) => own.organizationId === item.organizationId) &&
          all.findIndex((other) => other.organizationId === item.organizationId) === index,
      );
      const basis: Basis = verifiedAffiliationBasisSchema.parse({
        domain,
        claim,
        claims,
        facts: {
          claimed: claimed.map((item) => ({ organizationId: item.organizationId })),
          derived: derived.map((fact) => ({
            organizationId: fact.id,
            active: Boolean(fact.active),
            disputed: Boolean(fact.disputed),
            unknownProvenance: Boolean(fact.unknown),
          })),
          related: related.map(({ id, domain: claimDomain, organizationId }) => ({
            id,
            domain: claimDomain,
            organizationId,
          })),
        },
        organizations: batchRows(results[3]),
        identities: batchRows(results[4]),
        emailOwner: batchFirst(results[5]),
        takenSlugs: batchRows<{ slug: string }>(results[6]).map((row) => row.slug),
      });
      return { basis, address: toAddress(address) };
    },
  };
}
