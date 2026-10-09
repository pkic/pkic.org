import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { authErrors, ok, requiresSession } from "./route-contract";
import { badgePrintingResponseSchema, badgePrintResponseSchema } from "./route-contracts-event-badges";

/**
 * The signed-in holder's own badge: the same print artifact (QR SVG with the
 * readable code, names, role) and the same template and sponsor artwork the
 * organizer print document renders, so the phone ticket is the printed badge.
 */
export const currentBadgeResponseSchema = z
  .object({ badge: badgePrintResponseSchema, printing: badgePrintingResponseSchema })
  .strict();
export type CurrentBadge = z.infer<typeof currentBadgeResponseSchema>;

export const currentBadgeRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Ensure and read the signed-in attendee's own badge",
  description:
    "Returns the caller's newest active badge. When a confirmed registration holds none, one credential is issued once; " +
    "an organizer revocation stands until organizers issue a replacement. Other attendees' badges are never reachable.",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("The caller's badge artifact and its print design", currentBadgeResponseSchema),
    ...authErrors({
      notFound: "Event unavailable",
      conflict: "No confirmed registration, revoked badge, ended event, or changed badge details",
      unprocessable: "Badge template or sponsor artwork is invalid",
    }),
    "503": jsonErrorResponse("Badge print encryption or asset storage is unavailable"),
  },
};
