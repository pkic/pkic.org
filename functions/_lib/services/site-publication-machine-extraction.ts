import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { first } from "../db/queries";
import type { DatabaseLike } from "../types";
import { readPublicationAttempt } from "./site-publication-coordinator";
import {
  sitePublicationMachineContextSchema,
  sitePublicationCoordinatorConfigSchema,
} from "../../../assets/shared/schemas/site-publication-coordinator";
import { sitePublicationCiIdentitySchema } from "../../../assets/shared/schemas/site-publication-provider";

/** Native CI credentials reach D1 directly; no member-facing machine authorization endpoint exists. */
export async function assertPublicationMachineExtraction(db: DatabaseLike, env: Record<string, string | undefined>) {
  if (!env.SITE_PUBLICATION_COORDINATOR_CONFIG) return null;
  const config = sitePublicationCoordinatorConfigSchema.parse(JSON.parse(env.SITE_PUBLICATION_COORDINATOR_CONFIG));
  if (!config.enabled || !config.exclusiveActivationOwner) return null;
  const identity = sitePublicationCiIdentitySchema.parse(env);
  const context = sitePublicationMachineContextSchema.parse({
    identityType: "native_build_machine",
    attemptId: env.PKIC_PUBLICATION_ATTEMPT_ID,
    buildId: identity.WORKERS_CI_BUILD_UUID,
  });
  const attempt = await readPublicationAttempt(db, context.attemptId);
  if (
    !attempt ||
    attempt.phase !== "build_attested" ||
    attempt.buildId !== context.buildId ||
    config.environment !== env.CLOUDFLARE_ENV ||
    attempt.environment !== config.environment ||
    attempt.publicOrigin !== config.publicOrigin ||
    JSON.stringify(attempt.provider) !== JSON.stringify(config.provider) ||
    identity.WORKERS_CI_BRANCH !== attempt.provider.branch ||
    identity.WORKERS_CI_COMMIT_SHA.toLowerCase() !== attempt.provider.commitHash.toLowerCase()
  )
    throw new Error("PUBLICATION_EXTRACTION_AUTHORITY_CHANGED");
  const owned = await first<{ id: number }>(
    db,
    "SELECT f.id FROM site_publication_pipeline_fence f JOIN site_publication_provider_attempts a ON a.id=f.attempt_id JOIN site_publication_delivery_state s ON s.id=1 WHERE f.id=1 AND a.id=? AND f.lease_token=a.lease_token AND a.phase='build_attested' AND s.desired_sequence=a.source_sequence",
    [attempt.id],
  );
  if (!owned) throw new Error("PUBLICATION_EXTRACTION_AUTHORITY_CHANGED");
  return { ...context, sourceSequence: attempt.sourceSequence };
}

/** Recheck the same native build owner inside each extraction transaction. */
export function preparePublicationMachineExtractionGuard(
  db: DatabaseLike,
  machine: NonNullable<Awaited<ReturnType<typeof assertPublicationMachineExtraction>>>,
) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM site_publication_pipeline_fence fence JOIN site_publication_provider_attempts attempt ON attempt.id=fence.attempt_id JOIN site_publication_delivery_state state ON state.id=1 WHERE fence.id=1 AND attempt.id=? AND attempt.build_id=? AND attempt.phase='build_attested' AND fence.lease_token=attempt.lease_token AND state.desired_sequence=?`,
    bindings: [machine.attemptId, machine.buildId, machine.sourceSequence],
  });
}
