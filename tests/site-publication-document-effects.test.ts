import { ADMINISTRATOR_FIXTURE_USER_SQL, administratorGrants } from "./helpers/administrator";
import { runSitePublicationPipeline } from "../functions/_lib/services/site-publication-runtime";
import type { AuthAdmin } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { config, queue, uploaded, activationFetcher } from "./helpers/site-publication-coordinator";
import {
  prepareSitePublicationRequest,
  listSitePublicationRequests,
} from "../functions/_lib/services/site-publication-requests";
import {
  completePublicationDocumentEffectsForRequest,
  processPendingPublicationDocumentEffects,
  recordVerifiedPublicationActivationReceipt,
} from "../functions/_lib/services/site-publication-document-effects";
import {
  claimPublicationDispatch,
  readPublicationAttempt,
} from "../functions/_lib/services/site-publication-coordinator";
import { processSitePublicationDispatch } from "../functions/_lib/services/site-publication-dispatch";
import {
  activatePublicationAttempt,
  confirmPublicationActivation,
} from "../functions/_lib/services/site-publication-activation";
import {
  publicationDocumentEffectsSchema,
  publicationDocumentStorageKey,
} from "../assets/shared/schemas/site-publication-documents";
import { sitePublicationRequestQuerySchema } from "../assets/shared/schemas/site-publication-requests";
import { mutateBeforeNextBatch } from "./helpers/database-races";

function effect(eventId: string = crypto.randomUUID()) {
  return publicationDocumentEffectsSchema.parse([
    {
      eventId,
      eventSlug: "synthetic-publication",
      occurrenceId: crypto.randomUUID(),
      materialId: "approved-document",
      versionId: crypto.randomUUID(),
      digest: "a".repeat(64),
      grantId: crypto.randomUUID().replaceAll("-", "").repeat(2),
    },
  ])[0]!;
}
async function withdrawal(eventId: string, revision: number, effects = [effect(eventId)]) {
  const key = `withdrawal:${eventId}:${revision}`;
  await env.DB.batch([
    prepareSitePublicationRequest(env.DB, {
      resourceType: "event_agenda",
      resourceId: eventId,
      revision,
      reasonCode: "rights_withdrawn",
      deduplicationKey: key,
      documentEffects: effects,
    }),
  ]);
  return { key, effects };
}
async function ledger(key: string) {
  return (
    await queryAll<{
      document_effects_completed_at: string | null;
      status: string;
      last_error_code: string | null;
      last_error_at: string | null;
    }>(
      env.DB,
      "SELECT document_effects_completed_at,status,last_error_code,last_error_at FROM site_publication_requests WHERE deduplication_key=?",
      key,
    )
  )[0]!;
}
beforeEach(resetDb);
describe("durable publication document withdrawal effects", () => {
  it("retains exact immutable effects and completes only after a verified private terminal denial", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [user] = await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    const admin: AuthAdmin = {
      identityType: "user",
      id: user!.id,
      email: "synthetic@example.test",
      grants: administratorGrants,
    };
    const { key, effects } = await withdrawal(eventId, 1);
    const page = await listSitePublicationRequests(
      env.DB,
      admin,
      { resourceType: "event_agenda", resourceId: eventId },
      sitePublicationRequestQuerySchema.parse({}),
    );
    expect(page.requests[0]!.documentEffects).toEqual(effects);
    expect(await completePublicationDocumentEffectsForRequest(env.DB, undefined, key)).toBe(false);
    expect((await ledger(key)).document_effects_completed_at).toBeNull();
    expect((await ledger(key)).last_error_code).toBe("PUBLICATION_DOCUMENT_BUCKET_UNAVAILABLE");
    expect(await completePublicationDocumentEffectsForRequest(env.DB, env.SPEAKER_UPLOADS_BUCKET!, key)).toBe(true);
    expect((await ledger(key)).last_error_code).toBeNull();
    expect((await ledger(key)).last_error_at).toBeNull();
    const completed = (await ledger(key)).document_effects_completed_at;
    expect(completed).not.toBeNull();
    const object = await env.SPEAKER_UPLOADS_BUCKET!.get(publicationDocumentStorageKey(effects[0]!.grantId, "deny"));
    expect(JSON.parse(await object!.text())).toEqual({ ...effects[0], version: 1 });
    expect(await completePublicationDocumentEffectsForRequest(env.DB, undefined, key)).toBe(true);
    expect((await ledger(key)).document_effects_completed_at).toBe(completed);
    await expect(withdrawal(eventId, 1, [effect(eventId)])).rejects.toThrow("SITE_PUBLICATION_REQUEST_KEY_CONFLICT");
  });
  it("retries a partial external effect and guards the original payload before recording completion", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { key, effects } = await withdrawal(eventId, 1, [effect(eventId), effect(eventId)]);
    const invalidKey = publicationDocumentStorageKey(effects[1]!.grantId, "deny");
    await env.SPEAKER_UPLOADS_BUCKET!.put(invalidKey, "{}");
    expect(await completePublicationDocumentEffectsForRequest(env.DB, env.SPEAKER_UPLOADS_BUCKET!, key)).toBe(false);
    expect((await ledger(key)).document_effects_completed_at).toBeNull();
    expect((await ledger(key)).last_error_code).toBe("PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING");
    expect((await ledger(key)).last_error_at).not.toBeNull();
    expect(
      await env.SPEAKER_UPLOADS_BUCKET!.head(publicationDocumentStorageKey(effects[0]!.grantId, "deny")),
    ).not.toBeNull();
    await env.SPEAKER_UPLOADS_BUCKET!.delete(invalidKey);
    expect(await completePublicationDocumentEffectsForRequest(env.DB, env.SPEAKER_UPLOADS_BUCKET!, key)).toBe(true);
    expect((await ledger(key)).last_error_code).toBeNull();
    expect((await ledger(key)).last_error_at).toBeNull();
    const { key: racedKey } = await withdrawal(eventId, 2, effects);
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("DELETE FROM site_publication_requests WHERE deduplication_key=?").bind(racedKey).run(),
    );
    await expect(
      completePublicationDocumentEffectsForRequest(raced, env.SPEAKER_UPLOADS_BUCKET!, racedKey),
    ).rejects.toThrow("AUTHORIZATION_CONTEXT_CHANGED");
    await withdrawal(eventId, 2, effects);
    await env.DB.prepare(
      "UPDATE site_publication_requests SET last_error_code='PROVIDER_BUILD_FAILED',last_error_at=? WHERE deduplication_key=?",
    )
      .bind("2026-10-05T00:00:00.000Z", racedKey)
      .run();
    expect(await completePublicationDocumentEffectsForRequest(env.DB, env.SPEAKER_UPLOADS_BUCKET!, racedKey)).toBe(
      true,
    );
    expect((await ledger(racedKey)).last_error_code).toBe("PROVIDER_BUILD_FAILED");
    expect((await ledger(racedKey)).last_error_at).toBe("2026-10-05T00:00:00.000Z");
  });
  it("drains one bounded request per tick and prevents newer coalesced requests bypassing unfinished effects", async () => {
    const eventId = await queue();
    await withdrawal(eventId, 2);
    await withdrawal(eventId, 3);
    const fetcher = vi.fn();
    expect(await processSitePublicationDispatch(env.DB, config, "token", fetcher)).toEqual({
      state: "document_effects_pending",
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(claimPublicationDispatch(env.DB, config)).rejects.toThrow("AUTHORIZATION_CONTEXT_CHANGED");
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_provider_attempts")).toEqual([]);
    expect(await processPendingPublicationDocumentEffects(env.DB, env.SPEAKER_UPLOADS_BUCKET!)).toBe(false);
    expect(await processPendingPublicationDocumentEffects(env.DB, env.SPEAKER_UPLOADS_BUCKET!)).toBe(true);
    expect(await claimPublicationDispatch(env.DB, config)).not.toBeNull();
  });
  it.each(["absent", "disabled", "missing-token"] as const)(
    "completes denials before %s provider configuration gates without provider calls",
    async (gate) => {
      const { eventId } = await seedEventAndAdmin(env.DB);
      const { key } = await withdrawal(eventId, 1);
      const fetcher = vi.spyOn(globalThis, "fetch");
      const scoped = {
        ...env,
        SITE_PUBLICATION_COORDINATOR_CONFIG:
          gate === "absent" ? undefined : JSON.stringify({ ...config, enabled: gate !== "disabled" }),
        SITE_PUBLICATION_PROVIDER_TOKEN: undefined,
      };
      try {
        if (gate === "missing-token")
          await expect(runSitePublicationPipeline(scoped)).rejects.toThrow(
            "PUBLICATION_PROVIDER_CREDENTIAL_UNAVAILABLE",
          );
        else expect(await runSitePublicationPipeline(scoped)).toEqual({ state: "disabled" });
        expect((await ledger(key)).document_effects_completed_at).not.toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
        expect(await queryAll(env.DB, "SELECT id FROM site_publication_provider_attempts")).toEqual([]);
      } finally {
        fetcher.mockRestore();
      }
    },
  );
  it("retains a proven deployment receipt while completion evidence is pending and recovers without another activation", async () => {
    const effects = [effect()];
    const { attempt, release } = await uploaded(async (eventId) => {
      expect(
        await completePublicationDocumentEffectsForRequest(env.DB, env.SPEAKER_UPLOADS_BUCKET!, `agenda:${eventId}:1`),
      ).toBe(true);
    }, effects);
    const fetcher = activationFetcher(release);
    await activatePublicationAttempt(env.DB, config, attempt.id, "token", fetcher);
    // Model an in-flight activation whose previous completion checkpoint is unavailable after restart.
    await env.DB.prepare("UPDATE site_publication_requests SET document_effects_completed_at=NULL WHERE id=?")
      .bind(attempt.requestId)
      .run();
    await expect(confirmPublicationActivation(env.DB, config, attempt.id, "token", fetcher)).rejects.toThrow(
      "AUTHORIZATION_CONTEXT_CHANGED",
    );
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_activation_receipts")).toHaveLength(1);
    expect(
      (
        await queryAll<{ delivered_sequence: number }>(
          env.DB,
          "SELECT delivered_sequence FROM site_publication_delivery_state",
        )
      )[0]!.delivered_sequence,
    ).toBe(0);
    expect((await readPublicationAttempt(env.DB, attempt.id))!.phase).toBe("activating");
    const [receipt] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM site_publication_activation_receipts");
    await expect(
      recordVerifiedPublicationActivationReceipt(env.DB, (await readPublicationAttempt(env.DB, attempt.id))!, {
        id: receipt!.id,
        activatedAt: "2026-10-05T00:00:00.000Z",
      }),
    ).rejects.toThrow("AUTHORIZATION_CONTEXT_CHANGED");
    expect(
      (
        await queryAll<{ status: string }>(
          env.DB,
          "SELECT status FROM site_publication_requests WHERE id=?",
          attempt.requestId,
        )
      )[0]!.status,
    ).toBe("awaiting_activation");
    expect(await processPendingPublicationDocumentEffects(env.DB, env.SPEAKER_UPLOADS_BUCKET!)).toBe(true);
    expect((await confirmPublicationActivation(env.DB, config, attempt.id, "token", fetcher)).state).toBe("delivered");
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_activation_receipts")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  });
});
