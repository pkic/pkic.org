import { processPendingPublicationDocumentEffects } from "./site-publication-document-effects";
import type { Env } from "../types";
import { sitePublicationCoordinatorConfigSchema } from "../../../assets/shared/schemas/site-publication-coordinator";
import { reconcileSitePublication } from "./site-publication-reconciliation";
import { processSitePublicationCoordinator } from "./site-publication-dispatch";

/** Ownership and secrets are configured only through an explicitly approved deployment. */
export async function runSitePublicationPipeline(env: Env) {
  if (!(await processPendingPublicationDocumentEffects(env.DB, env.SPEAKER_UPLOADS_BUCKET)))
    return { state: "document_effects_pending" as const };
  if (!env.SITE_PUBLICATION_COORDINATOR_CONFIG) return { state: "disabled" as const };
  const config = sitePublicationCoordinatorConfigSchema.parse(JSON.parse(env.SITE_PUBLICATION_COORDINATOR_CONFIG));
  if (!config.enabled || !config.exclusiveActivationOwner) return { state: "disabled" as const };
  if (!env.SITE_PUBLICATION_PROVIDER_TOKEN) throw new Error("PUBLICATION_PROVIDER_CREDENTIAL_UNAVAILABLE");
  const reconciliation = await reconcileSitePublication(env.DB, config);
  const continuation = await processSitePublicationCoordinator(
    env.DB,
    config,
    env.SITE_PUBLICATION_PROVIDER_TOKEN,
    fetch,
    env.SPEAKER_UPLOADS_BUCKET,
  );
  return { ...continuation, reconciliation };
}
