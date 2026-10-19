import {
  eventAudienceDetailSchema,
  eventDetailResponseSchema,
} from "../../../../../../../shared/schemas/event-management";
import { ApiClientError, getJson } from "../../../../../../shared/api-client";
import { readActiveUserSession, scannerUploadSuspended } from "../../../../../../shared/pending-user-logout";
import type { PortalSession } from "../../../../types";

const scannerEventSchema = eventAudienceDetailSchema.pick({ id: true, name: true, scannerAccess: true });
type ScannerEvent = ReturnType<typeof scannerEventSchema.parse>;

/** One in-memory scanner context; no private API response or identity is persisted. */
export function createScannerEventBootstrap(currentSession: () => PortalSession | null) {
  let retained: { key: string; sessionId: string; ownerId: string; event: ScannerEvent } | null = null;
  function sessionChanged() {
    const session = currentSession();
    if (retained && (retained.sessionId !== session?.sessionId || retained.ownerId !== session?.identity.id))
      retained = null;
  }
  function scope(slug: string, sponsorId?: string) {
    sessionChanged();
    const session = currentSession();
    const deadlines = session
      ? [session.expiresAt, session.idleExpiresAt, session.staff?.expiresAt, session.staff?.idleExpiresAt].filter(
          (value): value is string => value !== undefined,
        )
      : [];
    if (!session || deadlines.some((value) => !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())) {
      retained = null;
      throw new Error("Sign in again before reopening the scanner.");
    }
    return {
      key: JSON.stringify([session.sessionId, session.identity.id, slug, sponsorId ?? null]),
      sessionId: session.sessionId,
      ownerId: session.identity.id,
    };
  }
  return {
    sessionChanged,
    async load(slug: string, sponsorId?: string, signal?: AbortSignal) {
      const expected = scope(slug, sponsorId);
      if (retained?.key !== expected.key) retained = null;
      const authorized = async () => {
        const active = await readActiveUserSession();
        if (
          scope(slug, sponsorId).key !== expected.key ||
          active?.sessionId !== expected.sessionId ||
          active.operatorUserId !== expected.ownerId ||
          (await scannerUploadSuspended(expected.ownerId, expected.sessionId))
        ) {
          retained = null;
          throw new Error("Sign in again before reopening the scanner.");
        }
        signal?.throwIfAborted();
      };
      await authorized();
      try {
        const response = await getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventDetailResponseSchema, {
          signal,
        });
        const event = scannerEventSchema.parse(response.event);
        await authorized();
        retained = { ...expected, event };
        return { event };
      } catch (error) {
        signal?.throwIfAborted();
        await authorized();
        if (!(error instanceof ApiClientError) || error.status !== 0) {
          if (retained?.key === expected.key) retained = null;
          throw error;
        }
        if (retained?.key !== expected.key) throw error;
        return { event: retained.event };
      }
    },
  };
}
