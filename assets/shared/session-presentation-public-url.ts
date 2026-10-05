import { z } from "zod";
import { databaseIdSchema } from "./schemas/identifiers.ts";
import { eventSlugParamsSchema } from "./schemas/api-common.ts";
import { sessionPresentationDigestSchema } from "./schemas/session-presentation-versions.ts";

export const sessionPresentationReleaseParamsSchema = eventSlugParamsSchema.extend({
  occurrenceId: databaseIdSchema,
  versionId: databaseIdSchema,
  digest: sessionPresentationDigestSchema,
});
export type SessionPresentationReleaseParams = z.infer<typeof sessionPresentationReleaseParamsSchema>;
export function sessionPresentationPublicUrl(input: SessionPresentationReleaseParams): string {
  const value = sessionPresentationReleaseParamsSchema.parse(input);
  return `/api/v1/events/${encodeURIComponent(value.eventSlug)}/agenda/occurrences/${value.occurrenceId}/materials/presentations/${value.versionId}/releases/${value.digest}/content`;
}
/** The sole public API material path; private version downloads remain excluded. */
export function parseSessionPresentationPublicUrl(value: string): SessionPresentationReleaseParams | null {
  const match =
    /^\/api\/v1\/events\/([^/]+)\/agenda\/occurrences\/([^/]+)\/materials\/presentations\/([^/]+)\/releases\/([^/]+)\/content$/u.exec(
      value,
    );
  if (!match) return null;
  try {
    const parsed = sessionPresentationReleaseParamsSchema.safeParse({
      eventSlug: decodeURIComponent(match[1]!),
      occurrenceId: match[2],
      versionId: match[3],
      digest: match[4],
    });
    return parsed.success && sessionPresentationPublicUrl(parsed.data) === value ? parsed.data : null;
  } catch {
    return null;
  }
}
