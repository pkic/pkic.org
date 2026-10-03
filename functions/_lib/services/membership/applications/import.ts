import { prepareImportedApplicationForm } from "./import-form";
import { prepareImportedIdentityLinks } from "./import-identities";
import { applicationImportEligibility } from "../../../../../assets/shared/membership-application-import";
import {
  applicationImportMappingSchema,
  githubApplicationEvidenceSchema,
  type GithubApplicationEvidence,
} from "../../../../../assets/shared/schemas/membership-application-import";
import { applicationSourceSnapshotSchema } from "../../../../../assets/shared/schemas/membership-application-source";
import {
  MANUAL_APPLICATION_HOLD,
  MANUAL_APPLICATION_HOLD_REASON,
} from "../../../../../assets/shared/schemas/member-applications";
import { preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike, UserBackedAuthAdmin, StatementLike } from "../../../types";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { prepareAuditLog } from "../../audit";
import { prepareImportedWorkflow } from "./import-workflow";
import { prepareClaimDomainForApplication } from "../organization-domain-claims";
import { requireMembershipCategory } from "../categories";
import { membershipApplicantPolicySchema } from "../../../../../assets/shared/schemas/membership-applicant-policy";

/** The authorized source reader must fetch every page again immediately before this command. */
export async function importMembershipApplication(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: {
    runId: string;
    expectedUpdatedAt: string;
    sourceIssueNumber: number;
    mapping: unknown;
    readSource: (issueNumber: number) => Promise<GithubApplicationEvidence>;
  },
) {
  const source = githubApplicationEvidenceSchema.parse(await input.readSource(input.sourceIssueNumber));
  const eligibility = applicationImportEligibility(source);
  if (source.issue.html_url !== `https://github.com/${source.repository}/issues/${source.issue.number}`)
    throw new AppError(422, "IMPORT_SOURCE_URL_INVALID", "The source URL must identify the original issue");
  if (
    !eligibility.eligible ||
    source.issue.number !== input.sourceIssueNumber ||
    source.issue.updated_at !== input.expectedUpdatedAt
  )
    throw new AppError(
      409,
      "IMPORT_SOURCE_CHANGED",
      `Reconcile current source evidence before importing: ${eligibility.reason}`,
    );
  const existing = await first<{ id: string; application_id: string | null }>(
    db,
    "SELECT id, application_id FROM membership_application_sources WHERE repository = ? AND issue_id = ?",
    [source.repository, String(source.issue.id)],
  );
  if (existing) return { id: existing.application_id ?? existing.id, imported: false };
  const mapping = applicationImportMappingSchema.parse(input.mapping);
  const historical = source.issue.state === "closed";
  if (historical !== (mapping.outcome !== null))
    throw new AppError(
      422,
      "IMPORT_OUTCOME_INVALID",
      "Closed history needs an explicit outcome; active work has no final outcome",
    );
  const now = nowIso();
  const id = uuid();
  const applicationId = historical ? null : uuid();
  const events = [
    ...source.comments.map((event) => ({ ...event, event: "comment" })),
    ...source.timeline.filter((event) => event.event !== "commented"),
  ].sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id);
  const snapshot = applicationSourceSnapshotSchema.parse({
    title: source.issue.title,
    body: source.issue.body ?? "",
    labels: source.issue.labels,
    state: source.issue.state,
    closureReason: source.issue.state_reason,
    events: events.map((event) => ({
      id: String(event.id),
      kind: event.event ?? "comment",
      author: event.user?.login ?? event.actor?.login ?? null,
      body: event.body ?? null,
      createdAt: event.created_at,
      metadata: event,
    })),
    attachmentUrls: [
      ...new Set(
        [source.issue.body ?? "", ...source.comments.map((comment) => comment.body ?? "")].flatMap(
          (body) =>
            body.match(
              /https:\/\/(?:github\.com\/user-attachments\/|user-images\.githubusercontent\.com\/)[^\s)<>]+/g,
            ) ?? [],
        ),
      ),
    ],
    warnings: [mapping.mappingReason, "Attachment references are preserved; availability has not been verified."],
  });
  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:approve" }]),
  ];
  statements.push(...(await prepareImportedIdentityLinks(db, mapping)));
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 1_500_000)
    throw new AppError(422, "IMPORT_EVIDENCE_TOO_LARGE", "Review oversized source evidence before import");
  statements.push(
    db
      .prepare(
        "INSERT INTO membership_application_import_runs (id, actor_user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(input.runId, actor.id, now),
  );
  if (applicationId) {
    if (!mapping.applicantName || !mapping.applicantEmail || !mapping.categoryCode)
      throw new AppError(
        422,
        "IMPORT_FIELDS_REQUIRED",
        "Reconcile the active applicant, email, and category before import",
      );
    const category = await requireMembershipCategory(db, mapping.categoryCode);
    membershipApplicantPolicySchema(category).parse({
      applicantEmail: mapping.applicantEmail,
      organizationName: mapping.organizationName ?? undefined,
    });
    const domain = category.isIndividual ? null : mapping.applicantEmail.split("@")[1];
    const held = source.issue.number === 795;
    const form = await prepareImportedApplicationForm(db, applicationId, mapping, source.issue.created_at);
    statements.push(...form.statements);
    statements.push(
      db
        .prepare(
          `INSERT INTO member_applications (id, applicant_user_id, applicant_email, applicant_name, organization_name, organization_domain, membership_category, form_submission_id, stage, stage_entered_at, on_hold_subtype, review_notes, manage_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          applicationId,
          mapping.applicantUserId,
          mapping.applicantEmail,
          mapping.applicantName,
          mapping.organizationName,
          domain,
          mapping.categoryCode,
          form.id,
          held ? "on_hold" : "processing",
          now,
          held ? MANUAL_APPLICATION_HOLD : null,
          held ? MANUAL_APPLICATION_HOLD_REASON : null,
          uuid(),
          source.issue.created_at,
          now,
        ),
    );
    if (domain) statements.push(prepareClaimDomainForApplication(db, domain, applicationId, now));
    statements.push(...(await prepareImportedWorkflow(db, applicationId, mapping, source, now)));
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO membership_application_sources (id, repository, issue_id, issue_number, issue_url, run_id, application_id, applicant_user_id, organization_id, applicant_name, applicant_email, organization_name, category_code, outcome, source_created_at, source_updated_at, closed_at, snapshot_json, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        source.repository,
        String(source.issue.id),
        source.issue.number,
        source.issue.html_url,
        input.runId,
        applicationId,
        mapping.applicantUserId,
        mapping.organizationId,
        mapping.applicantName,
        mapping.applicantEmail,
        mapping.organizationName,
        mapping.categoryCode,
        mapping.outcome,
        source.issue.created_at,
        source.issue.updated_at,
        source.issue.closed_at,
        JSON.stringify(snapshot),
        now,
      ),
  );
  statements.push(
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "membership_application_imported",
      "member_application",
      applicationId ?? id,
      {
        runId: input.runId,
        repository: source.repository,
        issueId: String(source.issue.id),
        reason: mapping.mappingReason,
      },
      now,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: membership_application_sources\.(repository|issue_id|issue_number)/.test(error.message)
    ) {
      const winner = await first<{ id: string; application_id: string | null }>(
        db,
        "SELECT id, application_id FROM membership_application_sources WHERE repository = ? AND issue_id = ?",
        [source.repository, String(source.issue.id)],
      );
      if (winner) return { id: winner.application_id ?? winner.id, imported: false };
    }
    throw error;
  }
  return { id: applicationId ?? id, imported: true };
}
