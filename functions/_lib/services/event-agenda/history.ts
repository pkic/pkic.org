import { sessionPresentationPublicUrl } from "../../../../assets/shared/session-presentation-public-url";
import {
  prepareSessionMaterialVersionGuard,
  type SessionMaterialVersionEvidence,
} from "./session-material-version-guard";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { preparePublicationDocumentEffects } from "../site-publication-document-selections";
import { completePublicationDocumentEffectsForRequest } from "../site-publication-document-effects";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  sessionAppearanceChoicesQuerySchema,
  sessionMaterialVersionsQuerySchema,
} from "../../../../assets/shared/schemas/event-session-history";
import {
  sessionHistoryMetadataSchema,
  publicSessionMaterials,
  sessionMaterialReleaseIdentity,
  verifiedSessionMaterialLegacyDownload,
} from "../../../../assets/shared/schemas/event-session-history";
import type { z } from "zod";
import type { DatabaseLike } from "../../types";
import { first, all } from "../../db/queries";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { ownedIdentityLifecycleSql } from "../identities/selection";
import { prepareRepresentationEligibility } from "./representation-eligibility";
import { commitAgendaRevision } from "./mutations";
import { getAgenda, getAgendaOccurrence } from "./read";
import { publicUserHeadshotPath } from "../user-headshot";

/** Audited corrections alter the draft only; an explicit publication creates a new archive. */
export async function saveSessionHistory(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  occurrenceId: string,
  expectedRevision: number,
  metadata: z.infer<typeof sessionHistoryMetadataSchema>,
  actorUserId: string,
  publicationBucket?: R2Bucket,
) {
  const validated = sessionHistoryMetadataSchema.safeParse(metadata);
  if (!validated.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validated.error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
    throw new AppError(400, "VALIDATION_ERROR", "Check the session history fields", { fieldErrors });
  }
  metadata = validated.data;
  const session = await getAgendaOccurrence(db, eventId, occurrenceId);
  for (const material of metadata.materials) {
    const previous = session.history?.materials.find((item) => item.id === material.id);
    if (material.status === "approved") {
      const retained =
        previous &&
        publicSessionMaterials([previous]).length === 1 &&
        sessionMaterialReleaseIdentity({
          ...material,
          approvedAt: previous.approvedAt,
          approvalNonce: previous.approvalNonce,
        }) === sessionMaterialReleaseIdentity(previous);
      material.approvalNonce = retained ? (previous.approvalNonce ?? null) : crypto.randomUUID();
      material.approvedAt = retained ? previous.approvedAt : nowIso();
    } else material.approvalNonce = previous?.approvalNonce ?? null;
  }
  if (
    JSON.stringify(metadata.proposalRepresentations) !== JSON.stringify(session.history?.proposalRepresentations ?? [])
  )
    throw new AppError(
      400,
      "PROPOSAL_REPRESENTATION_PROVENANCE_IMMUTABLE",
      "Review proposal representation changes through their source review.",
    );
  if (JSON.stringify(metadata.sourceDecisions) !== JSON.stringify(session.history?.sourceDecisions ?? []))
    throw new AppError(
      400,
      "SOURCE_DECISION_PROVENANCE_IMMUTABLE",
      "Review authored source decisions through the import review.",
    );
  if (
    JSON.stringify(metadata.legacyFragments) !== JSON.stringify(session.history?.legacyFragments ?? []) ||
    JSON.stringify(metadata.legacyDownloads) !== JSON.stringify(session.history?.legacyDownloads ?? [])
  )
    throw new AppError(
      400,
      "HISTORICAL_LINK_PROVENANCE_IMMUTABLE",
      "Review authored historical links through the import review.",
    );
  if (JSON.stringify(metadata.archivalCredits) !== JSON.stringify(session.history?.archivalCredits ?? []))
    throw new AppError(
      400,
      "ARCHIVAL_CREDIT_PROVENANCE_IMMUTABLE",
      "Resolve source credits through a verified historical import mapping.",
    );
  if (
    metadata.archivalTiming &&
    (session.startAt !== null || session.endAt !== null || metadata.archivalTiming.startAt >= nowIso())
  )
    throw new AppError(
      400,
      "ARCHIVAL_TIMING_PAST_SESSION_REQUIRED",
      "Partial source timing belongs to an unscheduled past historical session.",
    );
  if (
    metadata.archivalCredits.length &&
    ((!session.endAt && !metadata.archivalTiming) || (session.endAt !== null && session.endAt >= nowIso()))
  )
    throw new AppError(
      400,
      "ARCHIVAL_CREDIT_PAST_SESSION_REQUIRED",
      "Source-only credits belong to past historical sessions.",
    );
  const speakerIds = new Set(session.speakers.map((speaker) => speaker.userId));
  const approvalTime = Date.parse(nowIso());
  for (const appearance of metadata.appearances) {
    if (!speakerIds.has(appearance.userId))
      throw new AppError(400, "APPEARANCE_SPEAKER_MISMATCH", "Choose a speaker assigned to this session.");
    if (Date.parse(appearance.approvedAt) > approvalTime)
      throw new AppError(400, "APPEARANCE_APPROVAL_IN_FUTURE", "An appearance approval cannot be dated in the future.");
  }
  const representationGuards = await prepareRepresentationEligibility(
    db,
    metadata.appearances.map((appearance) => ({
      userId: appearance.userId,
      actingIdentityId: appearance.actingIdentityId,
      at: session.startAt ?? metadata.archivalTiming?.startAt ?? null,
    })),
  ).catch((error) => {
    if (error instanceof AppError && error.code === "AGENDA_REPRESENTATION_IDENTITY_UNAVAILABLE")
      throw new AppError(
        400,
        "APPEARANCE_IDENTITY_MISMATCH",
        "Choose an identity owned by this speaker and valid at the session date.",
      );
    throw error;
  });
  const versionEvidence: SessionMaterialVersionEvidence[] = [];
  for (const material of metadata.materials) {
    if (material.presentationVersionId && material.presentationSource === "session") {
      const version = await first<{
        version_number: number;
        review_status: string | null;
        source_digest: string;
        mime_type: string;
        file_size: number;
        review_id: string | null;
      }>(
        db,
        "SELECT version.version_number,version.source_digest,version.mime_type,version.file_size,review.id AS review_id,review.status AS review_status FROM session_presentation_versions version LEFT JOIN session_presentation_reviews review ON review.id=(SELECT latest.id FROM session_presentation_reviews latest WHERE latest.version_id=version.id ORDER BY latest.reviewed_at DESC,latest.id DESC LIMIT 1) WHERE version.id=? AND version.event_id=? AND version.occurrence_id=? AND version.deleted_at IS NULL",
        [material.presentationVersionId, eventId, occurrenceId],
      );
      if (!version)
        throw new AppError(400, "MATERIAL_VERSION_UNAVAILABLE", "Choose a presentation version from this session");
      if (version.mime_type !== "application/pdf")
        throw new AppError(400, "MATERIAL_PDF_REQUIRED", "Use a PDF upload for public session materials");
      if (material.legacyDownloadUrl !== null) {
        const receipt = session.history?.legacyDownloads.find((item) => item.url === material.legacyDownloadUrl);
        if (!receipt || receipt.pdfDigest === null || receipt.pdfBytes === null)
          throw new AppError(
            400,
            "MATERIAL_LEGACY_DOWNLOAD_UNVERIFIED",
            "Choose a stored historical download with verified PDF bytes.",
          );
        if (
          !verifiedSessionMaterialLegacyDownload(material, session.history?.legacyDownloads ?? [], {
            id: material.presentationVersionId,
            versionNumber: version.version_number,
            sourceDigest: version.source_digest,
            fileSize: version.file_size,
            mimeType: version.mime_type,
          })
        )
          throw new AppError(
            400,
            "MATERIAL_LEGACY_DOWNLOAD_MISMATCH",
            "The historical download must match the selected uploaded PDF bytes.",
          );
      }
      versionEvidence.push({
        versionId: material.presentationVersionId,
        versionNumber: version.version_number,
        digest: version.source_digest,
        bytes: version.file_size,
        mimeType: version.mime_type,
        latestReviewId: version.review_id,
      });
      material.url = sessionPresentationPublicUrl({
        eventSlug,
        occurrenceId,
        versionId: material.presentationVersionId,
        digest: version.source_digest,
      });
      if (material.version !== version.version_number)
        throw new AppError(
          400,
          "MATERIAL_VERSION_MISMATCH",
          "Use the uploaded presentation's canonical version number",
        );
      if (material.status === "approved" && version.review_status !== "approved")
        throw new AppError(
          400,
          "MATERIAL_VERSION_NOT_APPROVED",
          "The selected upload needs an approved review before release",
        );
    }
    if (material.presentationVersionId && material.presentationSource !== "session") {
      const version = await first<{ id: string; version_number: number; review_status: string | null }>(
        db,
        `SELECT pv.id,pv.version_number,(SELECT status FROM presentation_version_reviews WHERE version_id=pv.id ORDER BY reviewed_at DESC,id DESC LIMIT 1) AS review_status FROM presentation_versions pv JOIN session_proposals proposal ON proposal.id=pv.proposal_id JOIN event_agenda_occurrences occurrence ON occurrence.id=? AND occurrence.event_id=proposal.event_id WHERE pv.id=? AND proposal.event_id=? AND pv.deleted_at IS NULL AND proposal.deleted_at IS NULL AND (occurrence.source_key='proposal:'||proposal.id OR (COALESCE(occurrence.source_key,'') NOT LIKE 'proposal:%' AND EXISTS(SELECT 1 FROM proposal_speakers proposal_speaker JOIN event_agenda_occurrence_speakers agenda_speaker ON agenda_speaker.user_id=proposal_speaker.user_id AND agenda_speaker.occurrence_id=occurrence.id WHERE proposal_speaker.proposal_id=proposal.id AND proposal_speaker.status='confirmed')))`,
        [occurrenceId, material.presentationVersionId, eventId],
      );
      if (!version)
        throw new AppError(400, "MATERIAL_VERSION_UNAVAILABLE", "Choose a presentation version from this session.");
      if (material.version !== version.version_number)
        throw new AppError(
          400,
          "MATERIAL_VERSION_MISMATCH",
          "Use the uploaded presentation's canonical version number.",
        );
      if (material.status === "approved" && version.review_status !== "approved")
        throw new AppError(
          400,
          "MATERIAL_VERSION_NOT_APPROVED",
          "The selected upload requires an approved presentation review before release.",
        );
    }
    if (
      material.status === "approved" &&
      (!material.rightsConfirmed || !material.consentConfirmed || !material.validated || !material.approvedAt)
    )
      throw new AppError(
        400,
        "MATERIAL_RELEASE_INCOMPLETE",
        "Confirm rights, consent and validation before approving a material.",
      );
  }
  const released = publicSessionMaterials(metadata.materials);
  const withdrawn = publicSessionMaterials(session.history?.materials ?? []).some(
    (previous) =>
      !released.some((current) => sessionMaterialReleaseIdentity(current) === sessionMaterialReleaseIdentity(previous)),
  );
  const withdrawnIds = publicSessionMaterials(session.history?.materials ?? [])
    .filter(
      (previous) =>
        !released.some(
          (current) => sessionMaterialReleaseIdentity(current) === sessionMaterialReleaseIdentity(previous),
        ),
    )
    .map(({ id }) => id);
  const documentEffects = withdrawn
    ? await preparePublicationDocumentEffects(db, { eventId, occurrenceId, materialIds: withdrawnIds })
    : null;
  const withdrawalKey = `material-withdrawal:${occurrenceId}:${expectedRevision + 1}`;
  const materialStatements = [];
  if ([...metadata.materials, ...(session.history?.materials ?? [])].some((item) => item.kind === "presentation"))
    materialStatements.push(
      db
        .prepare("UPDATE event_agenda_occurrences SET presentation_url=? WHERE id=? AND event_id=?")
        .bind(released.find((item) => item.kind === "presentation")?.url ?? null, occurrenceId, eventId),
    );
  if ([...metadata.materials, ...(session.history?.materials ?? [])].some((item) => item.kind === "recording"))
    materialStatements.push(
      db
        .prepare("UPDATE event_agenda_occurrences SET recording_url=? WHERE id=? AND event_id=?")
        .bind(released.find((item) => item.kind === "recording")?.url ?? null, occurrenceId, eventId),
    );
  const versionGuard = prepareSessionMaterialVersionGuard(
    db,
    eventId,
    occurrenceId,
    metadata.materials,
    versionEvidence,
    session.history?.legacyDownloads ?? [],
  );
  await commitAgendaRevision(
    db,
    eventId,
    expectedRevision,
    [
      versionGuard.assert,
      ...(documentEffects ? [documentEffects.guard] : []),
      ...representationGuards,
      ...materialStatements,
      ...(withdrawn
        ? [
            prepareSitePublicationRequest(db, {
              resourceType: "session_material",
              resourceId: occurrenceId,
              revision: expectedRevision + 1,
              reasonCode: "rights_withdrawn",
              deduplicationKey: withdrawalKey,
              documentEffects: documentEffects?.effects ?? [],
            }),
          ]
        : []),
      db
        .prepare(
          "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(occurrence_id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
        )
        .bind(occurrenceId, JSON.stringify(metadata), actorUserId, nowIso()),
      versionGuard.cleanup,
    ],
    actorUserId,
  ).catch((error) => {
    if (error instanceof Error && error.message.includes("session_presentation_write_valid"))
      throw new AppError(
        409,
        "MATERIAL_VERSION_CHANGED",
        "The uploaded version changed; refresh before saving the material",
      );
    throw error;
  });
  if (
    withdrawn &&
    !(await completePublicationDocumentEffectsForRequest(db, publicationBucket, withdrawalKey).catch(() => false))
  )
    throw new AppError(
      503,
      "PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING",
      "The material change is saved. Public download withdrawal is pending; check publication status before claiming completion.",
      { changeRecorded: true, publicationPending: true, publicationRequestKey: withdrawalKey },
    );
  return getAgenda(db, eventId, eventSlug);
}

export async function listSessionAppearanceChoices(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  query: z.infer<typeof sessionAppearanceChoicesQuerySchema>,
) {
  const occurrence = await getAgendaOccurrence(db, eventId, occurrenceId);
  const date = occurrence.startAt ?? occurrence.history?.archivalTiming?.startAt ?? null;
  const conditions = ["speaker.occurrence_id=?", ownedIdentityLifecycleSql("identity", date === null ? null : "?")];
  const values: unknown[] = [occurrenceId, ...(date === null ? [] : [date, date, date])];
  if (query.userId) {
    conditions.push("identity.user_id=?");
    values.push(query.userId);
  }
  if (query.q) {
    conditions.push(
      "INSTR(LOWER(COALESCE(organization.name,'') || ' ' || COALESCE(identity.job_title,'')),LOWER(?))>0",
    );
    values.push(query.q);
  }
  const source = `FROM identities identity JOIN event_agenda_occurrence_speakers speaker ON speaker.user_id=identity.user_id LEFT JOIN organizations organization ON organization.id=identity.organization_id WHERE ${conditions.join(" AND ")}`;
  const total = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${source}`, values);
  const direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  const rows = await all<{
    id: string;
    user_id: string;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT identity.id,identity.user_id,organization.name AS organization_name,identity.job_title,identity.biography,
      (SELECT person.headshot_r2_key FROM users person WHERE person.id=identity.user_id AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL) AS headshot_r2_key
      ${source} ORDER BY organization.name ${direction},identity.id ASC LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  const portraits = await all<{ user_id: string; headshot_r2_key: string }>(
    db,
    `SELECT person.id AS user_id,person.headshot_r2_key FROM event_agenda_occurrence_speakers speaker
      JOIN users person ON person.id=speaker.user_id WHERE speaker.occurrence_id=? AND person.headshot_r2_key IS NOT NULL
      AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL ORDER BY person.id LIMIT 31`,
    [occurrenceId],
  );
  if (portraits.length > 30)
    throw new AppError(422, "AGENDA_APPEARANCE_ROSTER_LIMIT", "Review at most 30 credited people per session.");
  return {
    identities: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      organizationName: row.organization_name,
      jobTitle: row.job_title,
      biography: row.biography ?? "",
      photoUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
    })),
    portraits: portraits.map((person) => ({
      userId: person.user_id,
      photoUrl: publicUserHeadshotPath(person.user_id, person.headshot_r2_key),
    })),
    page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, rows.length),
  };
}

export async function listSessionMaterialVersions(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  query: z.infer<typeof sessionMaterialVersionsQuerySchema>,
) {
  await getAgendaOccurrence(db, eventId, occurrenceId);
  const source = `FROM (
    SELECT version.id,proposal.title,version.file_name,version.version_number,version.uploaded_at,'proposal' AS source,
      (SELECT status FROM presentation_version_reviews WHERE version_id=version.id ORDER BY reviewed_at DESC,id DESC LIMIT 1) AS review_status
    FROM presentation_versions version JOIN session_proposals proposal ON proposal.id=version.proposal_id JOIN event_agenda_occurrences occurrence ON occurrence.event_id=proposal.event_id AND occurrence.id=? WHERE proposal.event_id=? AND version.deleted_at IS NULL AND proposal.deleted_at IS NULL AND (occurrence.source_key='proposal:'||proposal.id OR (COALESCE(occurrence.source_key,'') NOT LIKE 'proposal:%' AND EXISTS(SELECT 1 FROM proposal_speakers proposal_speaker JOIN event_agenda_occurrence_speakers agenda_speaker ON agenda_speaker.user_id=proposal_speaker.user_id AND agenda_speaker.occurrence_id=occurrence.id WHERE proposal_speaker.proposal_id=proposal.id AND proposal_speaker.status='confirmed')))
    UNION ALL
    SELECT version.id,occurrence.title,version.file_name,version.version_number,version.uploaded_at,'session' AS source,
      (SELECT status FROM session_presentation_reviews WHERE version_id=version.id ORDER BY reviewed_at DESC,id DESC LIMIT 1) AS review_status
    FROM session_presentation_versions version JOIN event_agenda_occurrences occurrence ON occurrence.id=version.occurrence_id AND occurrence.event_id=version.event_id
    WHERE version.occurrence_id=? AND version.event_id=? AND version.deleted_at IS NULL
  ) choices WHERE INSTR(LOWER(COALESCE(file_name,'')||' '||title),LOWER(?))>0`;
  const bindings = [occurrenceId, eventId, occurrenceId, eventId, query.q ?? ""];
  const total = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${source}`, bindings);
  const direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  const rows = await all<{
    id: string;
    title: string;
    file_name: string | null;
    version_number: number;
    uploaded_at: string;
    review_status: string | null;
    source: "proposal" | "session";
  }>(
    db,
    `SELECT id,title,file_name,version_number,uploaded_at,review_status,source ${source} ORDER BY uploaded_at ${direction},id ASC,source ASC LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return {
    versions: rows.map((row) => ({
      id: row.id,
      source: row.source,
      title: row.title,
      fileName: row.file_name,
      version: row.version_number,
      reviewStatus: row.review_status,
      uploadedAt: row.uploaded_at,
    })),
    page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, rows.length),
  };
}
