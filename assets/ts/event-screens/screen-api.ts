import {
  screenPairingResponseSchema,
  screenReadResponseSchema,
  screenSessionPollResponseSchema,
  SCREEN_RELEASE_HEADER,
  SCREEN_SESSION_ERROR_CODES,
  type ScreenId,
  type ScreenReadResponse,
} from "../../shared/schemas/event-screens";
import { ApiClientError, requestJson } from "../shared/api-client";

const screenPath = (screenId: ScreenId) => `/api/v1/screens/${encodeURIComponent(screenId)}`;

/** The screen's own calls to the API, each timed so the screen can correct its clock. */
export const screenApi = {
  async read(
    screenId: ScreenId,
    agendaRevision: number | null,
    device: () => number = () => Date.now(),
    /** The server's release, as soon as the headers arrive: a body this page cannot read still names it. */
    onRelease?: (release: string | null) => void,
  ): Promise<{ response: ScreenReadResponse; sentAt: number; receivedAt: number }> {
    const query = agendaRevision === null ? "" : `?${new URLSearchParams({ agendaRevision: String(agendaRevision) })}`;
    const sentAt = device();
    const response = await requestJson(`${screenPath(screenId)}${query}`, screenReadResponseSchema, {
      onHeaders: (headers) => onRelease?.(headers.get(SCREEN_RELEASE_HEADER)),
    });
    return { response, sentAt, receivedAt: device() };
  },
  startPairing: (screenId: ScreenId) =>
    requestJson(`${screenPath(screenId)}/pairings`, screenPairingResponseSchema, { method: "POST" }),
  pollSession: (screenId: ScreenId) =>
    requestJson(`${screenPath(screenId)}/session`, screenSessionPollResponseSchema, { method: "POST" }),
};
export type ScreenApi = typeof screenApi;

const PAIR_AGAIN = new Set<string>(Object.values(SCREEN_SESSION_ERROR_CODES));

/** The server says this screen must show a pairing code. */
export function screenMustPair(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401 && PAIR_AGAIN.has(error.code);
}

/** The server could not be reached or failed; any other refusal is an answer. */
export function screenApiUnreachable(error: unknown): boolean {
  return !(error instanceof ApiClientError) || error.status === 0 || error.status >= 500;
}
