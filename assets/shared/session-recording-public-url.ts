import { z } from "zod";
import { databaseIdSchema } from "./schemas/identifiers.ts";
import { eventSlugParamsSchema } from "./schemas/api-common.ts";
import { sessionPresentationDigestSchema } from "./schemas/session-presentation-versions.ts";

export const sessionRecordingReleaseParamsSchema = eventSlugParamsSchema.extend({
  occurrenceId: databaseIdSchema,
  materialId: z
    .string()
    .min(1)
    .max(300)
    .refine((value) => !/\p{Cc}/u.test(value)),
  versionId: z.uuid(),
  digest: sessionPresentationDigestSchema,
});
export type SessionRecordingReleaseParams = z.infer<typeof sessionRecordingReleaseParamsSchema>;

/** A selected owned version; provider locations and storage keys never enter the public path. */
export function sessionRecordingPublicUrl(input: SessionRecordingReleaseParams): string {
  const value = sessionRecordingReleaseParamsSchema.parse(input);
  return `/api/v1/events/${encodeURIComponent(value.eventSlug)}/agenda/occurrences/${value.occurrenceId}/materials/${encodeURIComponent(value.materialId)}/recordings/${value.versionId}/releases/${value.digest}/content`;
}

export function parseSessionRecordingPublicUrl(value: string): SessionRecordingReleaseParams | null {
  const match =
    /^\/api\/v1\/events\/([^/]+)\/agenda\/occurrences\/([^/]+)\/materials\/([^/]+)\/recordings\/([^/]+)\/releases\/([^/]+)\/content$/u.exec(
      value,
    );
  if (!match) return null;
  try {
    const parsed = sessionRecordingReleaseParamsSchema.safeParse({
      eventSlug: decodeURIComponent(match[1]!),
      occurrenceId: match[2],
      materialId: decodeURIComponent(match[3]!),
      versionId: match[4],
      digest: match[5],
    });
    return parsed.success && sessionRecordingPublicUrl(parsed.data) === value ? parsed.data : null;
  } catch {
    return null;
  }
}
