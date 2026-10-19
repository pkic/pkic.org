import { processPendingPublicationDocumentEffects } from "./site-publication-document-effects";
import type { DatabaseLike } from "../types";
import {
  sitePublicationCoordinatorConfigSchema,
  type SitePublicationCoordinatorConfig,
} from "../../../assets/shared/schemas/site-publication-coordinator";
import { claimPublicationDispatch, dispatchPublicationAttempt } from "./site-publication-coordinator";
import { first } from "../db/queries";
import { readPublicationAttempt } from "./site-publication-coordinator";
import {
  activatePublicationAttempt,
  confirmPublicationActivation,
  recoverFailedPublicationBuild,
  supersedePublicationAttempt,
} from "./site-publication-activation";
import { PublicationProviderError } from "./site-publication-provider";

/** Scheduled entrypoint: disabled by default, one durable intent and one bounded provider call per tick. */
export async function processSitePublicationDispatch(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  token: string,
  fetcher: Parameters<typeof dispatchPublicationAttempt>[3] = fetch,
  bucket?: R2Bucket,
) {
  const checked = sitePublicationCoordinatorConfigSchema.parse(config);
  if (!checked.enabled || !checked.exclusiveActivationOwner) return { state: "disabled" as const };
  if (!(await processPendingPublicationDocumentEffects(db, bucket)))
    return { state: "document_effects_pending" as const };
  const attempt = await claimPublicationDispatch(db, checked);
  if (!attempt) return { state: "idle_or_fenced" as const };
  try {
    const receipt = await dispatchPublicationAttempt(db, attempt, token, fetcher);
    return receipt
      ? { state: "building" as const, attemptId: attempt.id, buildId: receipt.buildId }
      : { state: "authority_changed" as const };
  } catch (error) {
    if (error instanceof PublicationProviderError)
      return { state: "provider_error" as const, attemptId: attempt.id, errorCode: error.code };
    // Persistence/guard failures must remain errors; never claim a provider write was rejected.
    throw error;
  }
}

/** Bounded scheduled continuation. It never replays a durable activation intent. */
export async function processSitePublicationCoordinator(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  token: string,
  fetcher: Parameters<typeof dispatchPublicationAttempt>[3] = fetch,
  bucket?: R2Bucket,
) {
  const checked = sitePublicationCoordinatorConfigSchema.parse(config);
  if (!checked.enabled || !checked.exclusiveActivationOwner) return { state: "disabled" as const };
  const fence = await first<{ attempt_id: string | null }>(
    db,
    "SELECT attempt_id FROM site_publication_pipeline_fence WHERE id=1",
  );
  if (!fence?.attempt_id) return processSitePublicationDispatch(db, checked, token, fetcher, bucket);
  if (!(await processPendingPublicationDocumentEffects(db, bucket)))
    return { state: "document_effects_pending" as const };
  const attempt = await readPublicationAttempt(db, fence.attempt_id);
  if (!attempt) throw new Error("PUBLICATION_FENCE_EVIDENCE_MISSING");
  if (attempt.phase === "awaiting_activation") {
    const desired = await first<{ desired_sequence: number }>(
      db,
      "SELECT desired_sequence FROM site_publication_delivery_state WHERE id=1",
    );
    if (desired && desired.desired_sequence > attempt.sourceSequence)
      return supersedePublicationAttempt(db, checked, attempt.id, token, fetcher);
    return activatePublicationAttempt(db, checked, attempt.id, token, fetcher);
  }
  if (attempt.phase === "activating") return confirmPublicationActivation(db, checked, attempt.id, token, fetcher);
  if (attempt.phase === "building" || attempt.phase === "build_attested")
    return recoverFailedPublicationBuild(db, checked, attempt.id, token, fetcher);
  return { state: "fenced" as const, phase: attempt.phase, attemptId: attempt.id };
}
