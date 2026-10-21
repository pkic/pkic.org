import type { z } from "zod";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { speakerProfileApprovalSchema } from "../../../../assets/shared/schemas/event-speaker-profile-reviews";
import {
  sessionAppearanceSchema,
  sessionHistoryMetadataSchema,
} from "../../../../assets/shared/schemas/event-session-history";
import { all, first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { commitAgendaRevision } from "./revision";
import { getAgenda } from "./read";
import { agendaSettingsObject, agendaSettingsWriteSql } from "./settings-object";
import {
  decodeSpeakerProfile,
  speakerProfilesSql,
  speakerProfileColumns,
  type SpeakerProfileRow,
} from "./speaker-profile-review-read";

function unchangedProfilesGuard(db: DatabaseLike, eventId: string, rows: SpeakerProfileRow[], receipts: boolean) {
  return prepareAuthorizationGuard(db, {
    sql: `${speakerProfilesSql} SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS (
        SELECT 1 FROM reviewed_profiles current
        WHERE current.user_id=json_extract(expected.value,'$.userId')
        AND current.identity_id IS json_extract(expected.value,'$.identityId')
        AND current.profile_json=json_extract(expected.value,'$.profile')
        AND current.canonical_version=json_extract(expected.value,'$.version')
        AND current.available=1
        ${receipts ? "AND current.receipt IS json_extract(expected.value,'$.receipt') AND current.reviewed_at IS NOT NULL" : ""}
      ))`,
    bindings: [
      eventId,
      eventId,
      JSON.stringify(
        rows.map((row) => ({
          userId: row.user_id,
          identityId: row.identity_id,
          profile: row.profile_json,
          version: row.canonical_version,
          receipt: row.receipt,
        })),
      ),
    ],
  });
}

/** Persist only the reviewed identity/version receipt; profiles remain canonical, not session copies. */
export async function approveSpeakerProfile(
  db: DatabaseLike,
  eventId: string,
  slug: string,
  input: z.infer<typeof speakerProfileApprovalSchema>,
  actorId: string,
) {
  const row = await first<SpeakerProfileRow>(
    db,
    `${speakerProfilesSql} SELECT ${speakerProfileColumns} FROM reviewed_profiles WHERE user_id=? AND identity_id=?`,
    [eventId, eventId, input.userId, input.identityId],
  );
  if (!row || !row.available)
    throw new AppError(
      409,
      "SPEAKER_PROFILE_UNAVAILABLE",
      "Choose an active identity assigned to a scheduled speaker.",
    );
  const profile = await decodeSpeakerProfile(row);
  if (profile.profileDigest !== input.profileDigest)
    throw new AppError(
      409,
      "SPEAKER_PROFILE_CHANGED",
      "This speaker profile changed. Review the latest version before approving it.",
    );
  const reviewedAt = nowIso();
  const receipt = {
    userId: input.userId,
    canonicalVersion: row.canonical_version,
    profileDigest: input.profileDigest,
    reviewedAt,
    reviewedBy: actorId,
  };
  const event = await first<{ settings_json: string }>(db, "SELECT settings_json FROM events WHERE id=?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const agenda = agendaSettingsObject(agendaSettingsObject(JSON.parse(event.settings_json)).agenda);
  const reviews = agendaSettingsObject(agenda.speakerProfileReviews);
  reviews[input.identityId] = receipt;
  agenda.speakerProfileReviews = reviews;
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      unchangedProfilesGuard(db, eventId, [row], false),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM events WHERE id=? AND settings_json=?",
        bindings: [eventId, event.settings_json],
      }),
      db
        .prepare(`UPDATE events SET settings_json=${agendaSettingsWriteSql} WHERE id=? AND settings_json=?`)
        .bind(JSON.stringify(agenda), eventId, event.settings_json),
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        "user",
        actorId,
        "agenda.speaker_profile.approved",
        "identity",
        input.identityId,
        { userId: input.userId, profileDigest: input.profileDigest },
        reviewedAt,
      ),
    ],
    actorId,
  );
  return { agenda: await getAgenda(db, eventId, slug) };
}

/** Materialize reviewed canonical profiles only at the existing immutable publication boundary. */
export async function prepareReviewedSpeakerProfiles(
  db: DatabaseLike,
  eventId: string,
  snapshot: AgendaSnapshot,
  strict = true,
) {
  const rows: SpeakerProfileRow[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = await all<SpeakerProfileRow>(
      db,
      `${speakerProfilesSql} SELECT ${speakerProfileColumns} FROM reviewed_profiles ORDER BY user_id,identity_id LIMIT 100 OFFSET ?`,
      [eventId, eventId, offset],
    );
    rows.push(...page);
    if (page.length < 100) break;
    if (offset === 9900)
      throw new AppError(
        422,
        "SPEAKER_PROFILE_REVIEW_LIMIT",
        "Review an agenda with fewer than 10,000 speaker profiles.",
      );
  }
  const byOccurrence = new Map<string, Map<string, z.infer<typeof sessionAppearanceSchema>>>();
  const reviewedRows: SpeakerProfileRow[] = [];
  for (const row of rows) {
    const receipt = row.receipt ? JSON.parse(row.receipt) : null;
    // Explicit existing session approvals remain valid. Once an event-level review
    // exists, its version must be current; an older session credit cannot bypass it.
    if (
      !receipt &&
      !row.explicit_identity &&
      (JSON.parse(row.occurrence_ids) as string[]).every((id) =>
        snapshot.occurrences
          .find((occurrence) => occurrence.id === id)
          ?.history?.appearances.some((appearance) => appearance.userId === row.user_id && appearance.approvedAt),
      )
    )
      continue;
    const profile = await decodeSpeakerProfile(row);
    if (!row.available || !profile.reviewedAt || receipt?.profileDigest !== profile.profileDigest) {
      if (!strict) continue;
      throw new AppError(
        422,
        "AGENDA_REPRESENTATION_REVIEW_REQUIRED",
        "Review pending speaker profiles in the publication workspace before approving this agenda.",
      );
    }
    reviewedRows.push(row);
    const appearance = sessionAppearanceSchema.parse({
      userId: profile.userId,
      displayName: profile.displayName,
      affiliations: [
        {
          identityId: profile.identityId,
          title: profile.jobTitle,
          organizationId: profile.organizationId,
          organizationName: profile.organizationName,
        },
      ],
      biography: profile.biography ?? "",
      links: profile.links,
      photoUrl: profile.photoUrl,
      approvedAt: profile.reviewedAt,
    });
    for (const id of JSON.parse(row.occurrence_ids) as string[]) {
      const people = byOccurrence.get(id) ?? new Map();
      const previous = people.get(profile.userId);
      const primaryId = snapshot.occurrences
        .find((occurrence) => occurrence.id === id)
        ?.speakers.find((speaker) => speaker.userId === profile.userId)?.profileCandidate?.identityId;
      if (previous) {
        const primary = primaryId === profile.identityId ? appearance : previous;
        people.set(profile.userId, {
          ...primary,
          affiliations: [...previous.affiliations, ...appearance.affiliations],
        });
      } else people.set(profile.userId, appearance);
      byOccurrence.set(id, people);
    }
  }
  const guards = [];
  for (let offset = 0; offset < reviewedRows.length; offset += 100)
    guards.push(unchangedProfilesGuard(db, eventId, reviewedRows.slice(offset, offset + 100), true));
  return {
    guards,
    snapshot: {
      ...snapshot,
      occurrences: snapshot.occurrences.map((occurrence) => {
        const profiles = byOccurrence.get(occurrence.id);
        if (!profiles) return occurrence;
        for (const [userId, appearance] of profiles) {
          const order =
            occurrence.speakers
              .find((speaker) => speaker.userId === userId)
              ?.profileCandidates?.map((candidate) => candidate.identityId) ?? [];
          appearance.affiliations.sort(
            (left, right) => order.indexOf(left.identityId) - order.indexOf(right.identityId),
          );
        }
        const history = sessionHistoryMetadataSchema.parse(occurrence.history ?? {});
        return {
          ...occurrence,
          history: {
            ...history,
            appearances: [...history.appearances.filter((a) => !profiles.has(a.userId)), ...profiles.values()],
          },
        };
      }),
    },
  };
}
