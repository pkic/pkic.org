import type { PublicationDocumentEffect } from "../../assets/shared/schemas/site-publication-documents";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { seedEventAndAdmin } from "./context";
import { prepareSitePublicationRequest } from "../../functions/_lib/services/site-publication-requests";
import {
  claimPublicationDispatch,
  dispatchPublicationAttempt,
} from "../../functions/_lib/services/site-publication-coordinator";
import { completePublicationMachineBuild } from "../../functions/_lib/services/site-publication-activation";
import {
  sitePublicationReleaseSchema,
  publicationIntegrityHashInput,
} from "../../assets/shared/schemas/site-publication-release";
import { sha256Hex } from "../../functions/_lib/utils/crypto";
export const config = {
  environment: "production" as const,
  publicOrigin: "https://pkic.org",
  enabled: true,
  exclusiveActivationOwner: true,
  debounceSeconds: 0,
  provider: {
    accountId: "a".repeat(32),
    triggerId: "11111111-1111-4111-8111-111111111111",
    scriptName: "pkic-site",
    branch: "main",
    commitHash: "b".repeat(40),
    workerTag: "c".repeat(32),
    repoConnectionId: "22222222-2222-4222-8222-222222222222",
    repositoryId: "123",
    providerAccountId: "456",
  },
};
export const buildId = "33333333-3333-4333-8333-333333333333";
export async function queue(revision = 1, documentEffects: PublicationDocumentEffect[] = []) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  await env.DB.batch([
    prepareSitePublicationRequest(env.DB, {
      resourceType: "event_agenda",
      resourceId: eventId,
      revision,
      reasonCode: "agenda_approved",
      documentEffects,
      deduplicationKey: `agenda:${eventId}:${revision}`,
    }),
  ]);
  return eventId;
}
export const versionId = "44444444-4444-4444-8444-444444444444";
export const deploymentId = "55555555-5555-4555-8555-555555555555";
export async function uploaded(
  prepare?: (eventId: string) => Promise<void>,
  documentEffects: PublicationDocumentEffect[] = [],
) {
  const eventId = await queue(1, documentEffects);
  await prepare?.(eventId);
  const attempt = (await claimPublicationDispatch(env.DB, config))!;
  await dispatchPublicationAttempt(env.DB, attempt, "token", async () =>
    Response.json({ success: true, result: { build_uuid: buildId } }),
  );
  await env.DB.prepare("UPDATE site_publication_provider_attempts SET phase='build_attested' WHERE id=?")
    .bind(attempt.id)
    .run();
  const files = { "index.html": { sha256: "a".repeat(64), bytes: 12 } };
  const release = sitePublicationReleaseSchema.parse({
    version: 1,
    source: "native",
    environment: "production",
    sourceSequence: attempt.sourceSequence,
    snapshotId: "b".repeat(64),
    integrity: { algorithm: "sha256", digest: await sha256Hex(publicationIntegrityHashInput(files)), files },
    files: ["index.html"],
  });
  const machine = { identityType: "native_build_machine" as const, attemptId: attempt.id, buildId };
  await completePublicationMachineBuild(env.DB, machine, { release, versionId, workerBundleSha256: "c".repeat(64) });
  return { attempt, release, machine };
}
export function activationFetcher(release: unknown, losePost = false, partial = false) {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("/versions/")) return Response.json({ success: true, result: { id: versionId } });
    if (url.includes("version_ids="))
      return Response.json({
        success: true,
        result: {
          builds: {
            [versionId]: {
              build_uuid: buildId,
              status: "stopped",
              build_outcome: "success",
              build_trigger_metadata: { branch: "main", commit_hash: config.provider.commitHash },
              trigger: {
                trigger_uuid: config.provider.triggerId,
                external_script_id: config.provider.workerTag,
                repo_connection: {
                  repo_connection_uuid: config.provider.repoConnectionId,
                  repo_id: "123",
                  provider_account_id: "456",
                },
              },
            },
          },
        },
      });
    if (url.endsWith("/publication.json")) return Response.json(release);
    const deployment = {
      id: deploymentId,
      created_on: "2026-10-04T00:00:00.000Z",
      strategy: "percentage",
      versions: [{ version_id: versionId, percentage: partial ? 50 : 100 }],
    };
    if (init.method === "POST") {
      if (losePost) throw new Error("response lost");
      return Response.json({ success: true, result: deployment });
    }
    return Response.json({ success: true, result: { deployments: [deployment] } });
  });
}
