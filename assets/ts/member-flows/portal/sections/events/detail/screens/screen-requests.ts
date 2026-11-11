/** The staff requests behind the Screens tab, each on its shared route contract. */
import { noContentResponseSchema } from "../../../../../../../shared/schemas/api-common";
import {
  SCREEN_REVISION_CONFLICT_CODE,
  eventScreenPairingCreateSchema,
  screenRecordSchema,
  screenStaffViewSchema,
  screenUpdateSchema,
  type EventScreenPairingCreate,
  type ScreenRecord,
  type ScreenUpdate,
} from "../../../../../../../shared/schemas/event-screens";
import {
  ApiClientError,
  getJson,
  patchValidated,
  postValidated,
  requestJson,
} from "../../../../../../shared/api-client";

export const eventScreensPath = (slug: string) => `/api/v1/events/${encodeURIComponent(slug)}/screens`;
const screenPath = (screenId: string) => `/api/v1/screens/${encodeURIComponent(screenId)}`;

export function pairScreen(slug: string, body: EventScreenPairingCreate): Promise<ScreenRecord> {
  return postValidated(eventScreensPath(slug), eventScreenPairingCreateSchema, body, screenRecordSchema);
}

export function updateScreen(screenId: string, body: ScreenUpdate): Promise<ScreenRecord> {
  return patchValidated(screenPath(screenId), screenUpdateSchema, body, screenRecordSchema);
}

/** The staff record as it stands now, for an editor whose revision went stale. */
export async function readScreenRecord(screenId: string): Promise<ScreenRecord> {
  return (await getJson(screenPath(screenId), screenStaffViewSchema)).screen;
}

export async function revokeScreenSession(screenId: string): Promise<void> {
  await requestJson(`${screenPath(screenId)}/session`, noContentResponseSchema, { method: "DELETE" });
}

export function isScreenRevisionConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409 && error.code === SCREEN_REVISION_CONFLICT_CODE;
}
