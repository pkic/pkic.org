import {
  independentCapacityReviewSchema,
  type IndependentCapacityDisclosure,
  type IndependentCapacityReview,
} from "../../../assets/shared/schemas/independent-capacity";
import { all } from "../db/queries";
import { emailDomainKind } from "../email-domains/contact-kind";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { uuid } from "../utils/ids";
import { prepareAuditLog } from "./audit";

/** The disclosure an individual selection must carry; refused rather than silently stored without one. */
export function requireIndependentDisclosure(
  disclosure: IndependentCapacityDisclosure | undefined,
): IndependentCapacityDisclosure {
  if (!disclosure)
    throw new AppError(
      422,
      "INDEPENDENT_CAPACITY_REQUIRED",
      "Complete the independence questions to take part as an individual.",
      {
        "independentCapacity.organizationConnection": "Complete the independence questions.",
      },
    );
  return disclosure;
}

/**
 * Records a completed disclosure for one proposal speaker: the current record
 * is superseded and the new one, with its wording version, answers and the
 * kind of address the person confirmed, starts pending review. Audited in the
 * same batch.
 */
export function prepareIndependentDisclosure(
  db: DatabaseLike,
  input: {
    proposalId: string;
    proposalSpeakerId: string;
    userId: string;
    email: string;
    disclosure: IndependentCapacityDisclosure;
    actor: { type: string; id: string | null };
    at: string;
  },
): StatementLike[] {
  const id = uuid();
  const kind = emailDomainKind(input.email);
  const { version, ...answers } = input.disclosure;
  return [
    prepareSupersedeIndependentDisclosure(db, input.proposalSpeakerId, input.at),
    db
      .prepare(
        `INSERT INTO proposal_speaker_independent_disclosures
          (id,proposal_speaker_id,user_id,text_version,answers_json,email_domain_kind,attested_at,review_status)
         VALUES(?,?,?,?,?,?,?,'pending')`,
      )
      .bind(id, input.proposalSpeakerId, input.userId, version, JSON.stringify(answers), kind, input.at),
    prepareAuditLog(
      db,
      input.actor.type,
      input.actor.id,
      "independent_capacity_disclosed",
      "proposal_speaker",
      input.proposalSpeakerId,
      // The free-text answers live on the disclosure record only, where anonymization can clear them.
      { disclosureId: id, version, emailDomainKind: kind },
      input.at,
      null,
      { type: "proposal", id: input.proposalId },
    ),
  ];
}

/** A speaker who now acts for an organization no longer relies on an independence disclosure. */
export function prepareSupersedeIndependentDisclosure(
  db: DatabaseLike,
  proposalSpeakerId: string,
  at: string,
): StatementLike {
  return db
    .prepare(
      "UPDATE proposal_speaker_independent_disclosures SET superseded_at=? WHERE proposal_speaker_id=? AND superseded_at IS NULL",
    )
    .bind(at, proposalSpeakerId);
}

interface DisclosureRow {
  id: string;
  proposal_speaker_id: string;
  user_id: string;
  text_version: string;
  answers_json: string;
  email_domain_kind: string;
  attested_at: string;
  review_status: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
}

export const currentIndependentDisclosureColumns = `disclosure.id,disclosure.proposal_speaker_id,disclosure.user_id,
  disclosure.text_version,disclosure.answers_json,disclosure.email_domain_kind,disclosure.attested_at,
  disclosure.review_status,disclosure.reviewed_at,
  NULLIF(TRIM(COALESCE(reviewer.first_name,'') || ' ' || COALESCE(reviewer.last_name,'')),'') AS reviewed_by_name`;

export function toIndependentCapacityReview(row: DisclosureRow): IndependentCapacityReview {
  const answers = JSON.parse(row.answers_json) as { formerAffiliations?: string; currentPosition?: string };
  return independentCapacityReviewSchema.parse({
    id: row.id,
    version: row.text_version,
    formerAffiliations: answers.formerAffiliations ?? "",
    currentPosition: answers.currentPosition ?? "",
    emailDomainKind: row.email_domain_kind,
    attestedAt: row.attested_at,
    status: row.review_status,
    reviewedAt: row.reviewed_at,
    reviewedByName: row.reviewed_by_name,
  });
}

/** Every current disclosure on one proposal's roster, keyed by speaker user, in one bounded read. */
export async function listCurrentIndependentDisclosures(
  db: DatabaseLike,
  proposalId: string,
): Promise<Map<string, IndependentCapacityReview>> {
  const rows = await all<DisclosureRow>(
    db,
    `SELECT ${currentIndependentDisclosureColumns}
     FROM proposal_speakers speaker
     JOIN proposal_speaker_independent_disclosures disclosure
       ON disclosure.proposal_speaker_id=speaker.id AND disclosure.superseded_at IS NULL
     LEFT JOIN users reviewer ON reviewer.id=disclosure.reviewed_by
     WHERE speaker.proposal_id=?
     LIMIT 100`,
    [proposalId],
  );
  return new Map(rows.map((row) => [row.user_id, toIndependentCapacityReview(row)]));
}
